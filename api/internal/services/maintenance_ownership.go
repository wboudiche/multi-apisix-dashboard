// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// Why an ownership record is orphaned.
const (
	// OwnershipInstanceGone: no instance answers to the record's instance id.
	OwnershipInstanceGone = "instance_gone"
	// OwnershipTypeNotShared: the record is for a type teams do not share, and
	// nothing reads it (#249).
	OwnershipTypeNotShared = "type_not_team_scoped"
	// OwnershipResourceGone: the gateway listed the type, and the resource was
	// not in it.
	OwnershipResourceGone = "resource_gone"
)

// OrphanedOwnership is an ownership record with nothing left to own.
type OrphanedOwnership struct {
	Key          string `json:"key"`
	InstanceID   string `json:"instance_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	TeamID       string `json:"team_id,omitempty"`
	Reason       string `json:"reason"`
}

// UncheckedInstance is an instance, or one resource type on it, whose records
// were not judged because its gateway could not say what it holds. With no
// resource type, none of the instance's records for shared types were judged.
type UncheckedInstance struct {
	InstanceID   string `json:"instance_id"`
	ResourceType string `json:"resource_type,omitempty"`
	Reason       string `json:"reason"`
}

// OwnershipReport is what a sweep of the ownership records found.
type OwnershipReport struct {
	Orphans   []OrphanedOwnership `json:"orphans"`
	Unchecked []UncheckedInstance `json:"unchecked_instances"`
}

// uncheckedReason says why the records of a type on an instance went unjudged,
// or "" if they were judged.
func (r *OwnershipReport) uncheckedReason(instanceID, resourceType string) string {
	for _, u := range r.Unchecked {
		switch {
		case u.InstanceID != instanceID:
		case u.ResourceType == "":
			return "its instance could not be checked"
		case u.ResourceType == resourceType:
			return "its type could not be listed"
		}
	}
	return ""
}

// errGatewayUnreachable marks a list that failed before any answer came back.
// It belongs to the gateway, not to the type asked about.
var errGatewayUnreachable = errors.New("gateway unreachable")

// resourceLister reads the id of every resource of a type on an instance.
// A failure to reach the gateway at all wraps errGatewayUnreachable.
type resourceLister interface {
	ListResourceIDs(ctx context.Context, instance *models.Instance, resourceType string) (map[string]bool, error)
}

// apisixResourceLister lists resources through the instance's Admin API.
type apisixResourceLister struct {
	client *http.Client
}

func newAPISIXResourceLister() apisixResourceLister {
	return apisixResourceLister{client: &http.Client{Timeout: 10 * time.Second}}
}

func (l apisixResourceLister) ListResourceIDs(ctx context.Context, instance *models.Instance, resourceType string) (map[string]bool, error) {
	url := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin/" + resourceType
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if instance.AdminKey != "" {
		req.Header.Set("X-API-Key", instance.AdminKey)
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errGatewayUnreachable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("answered %d", resp.StatusCode)
	}

	var body struct {
		List json.RawMessage `json:"list"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("unreadable list: %w", err)
	}
	return parseResourceIDs(body.List)
}

// parseResourceIDs reads the ids out of an Admin API list. An empty list comes
// back as {} rather than [] from some APISIX versions; anything else that is
// not a list is an error, never an empty gateway.
//
// A row's id is the last segment of its key, which is what the proxy records
// ownership under when a write names none. The value's id may be a number -
// APISIX keeps one sent as {"id": 123} - and consumers carry a username.
func parseResourceIDs(list json.RawMessage) (map[string]bool, error) {
	ids := map[string]bool{}
	trimmed := bytes.TrimSpace(list)
	switch {
	case bytes.Equal(trimmed, []byte("{}")):
		return ids, nil
	case bytes.Equal(trimmed, []byte("null")):
		// Read as a list, null is an empty one, and every record on the
		// instance would look orphaned.
		return nil, errors.New("list is null")
	}
	var rows []struct {
		Key   string `json:"key"`
		Value struct {
			ID       json.RawMessage `json:"id"`
			Username string          `json:"username"`
		} `json:"value"`
	}
	if err := json.Unmarshal(trimmed, &rows); err != nil {
		return nil, fmt.Errorf("unreadable list: %w", err)
	}
	for _, row := range rows {
		id := ""
		if i := strings.LastIndex(row.Key, "/"); i >= 0 {
			id = row.Key[i+1:]
		}
		if id == "" {
			id = scalarID(row.Value.ID)
		}
		if id == "" {
			id = row.Value.Username
		}
		if id != "" {
			ids[id] = true
		}
	}
	return ids, nil
}

// scalarID reads an id that may be a JSON string or a number.
func scalarID(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	return ""
}

// ownershipScope says which types on which instances a sweep asks gateways
// about. nil asks about everything.
type ownershipScope func(instanceID, resourceType string) bool

// FindOrphanedOwnership lists the ownership records nothing is left to own.
// Deleting a resource removes its record since #249; the ones left before that
// still count against their team and reserve their id (#248).
func (s *MaintenanceService) FindOrphanedOwnership(ctx context.Context) (*OwnershipReport, error) {
	report, _, _, err := s.readOrphanedOwnership(ctx, nil)
	return report, err
}

// readOrphanedOwnership also returns every record it read, with its revision,
// so a purge can tell a record that is not orphaned from one that is not there,
// and leave one written since.
func (s *MaintenanceService) readOrphanedOwnership(ctx context.Context, scope ownershipScope) (*OwnershipReport, map[string][]byte, map[string]int64, error) {
	// Records first, gateways after. A resource created in between has no
	// record in the first read to be misjudged; read the other way round, its
	// record would name a resource the gateway had not listed yet.
	records, revisions, err := s.etcd.ListWithRevisions(ctx, models.KeyPrefixOwnership)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("could not read ownership records: %w", err)
	}
	instances, err := s.etcd.List(ctx, models.KeyPrefixInstances)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("could not read instances: %w", err)
	}
	return judgeOwnership(ctx, records, instances, s.lister, scope), records, revisions, nil
}

// PurgeOrphanedOwnership deletes the given record keys, each only if it is
// still orphaned when the purge runs and unchanged since. Only the gateways and
// types the keys name are asked.
func (s *MaintenanceService) PurgeOrphanedOwnership(ctx context.Context, keys []string) (*PurgeResult, error) {
	named := map[string]bool{}
	for _, key := range keys {
		if instanceID, resourceType, _, ok := parseOwnershipKey(key); ok {
			named[instanceID+"/"+resourceType] = true
		}
	}
	report, records, revisions, err := s.readOrphanedOwnership(ctx, func(instanceID, resourceType string) bool {
		return named[instanceID+"/"+resourceType]
	})
	if err != nil {
		return nil, err
	}
	orphaned := make(map[string]bool, len(report.Orphans))
	for _, o := range report.Orphans {
		orphaned[o.Key] = true
	}

	return s.purgeKeys(ctx, keys, orphaned, revisions, func(key string) string {
		if _, ok := records[key]; !ok {
			return "no such ownership record"
		}
		if instanceID, resourceType, _, ok := parseOwnershipKey(key); ok {
			if reason := report.uncheckedReason(instanceID, resourceType); reason != "" {
				return reason
			}
		}
		return "its resource exists"
	}), nil
}

// judgeOwnership works out which records have nothing left to own, from the raw
// records under /ownership/ and instances under /instances/, asking each
// gateway only for the types its records name and the scope allows.
//
// An instance exists if its key does. One whose record does not parse, or that
// is inactive, is still an instance; only its gateway is not asked, and its
// records for shared types go unjudged. So does every type of a gateway that
// cannot be reached, which is not asked again for the next type: each attempt
// would wait out its own timeout for the same answer. A type the gateway
// answers with an error goes unjudged on its own - stream routes on a gateway
// with stream mode off answer 400 - while its other types are still judged.
func judgeOwnership(ctx context.Context, records, rawInstances map[string][]byte, lister resourceLister, scope ownershipScope) *OwnershipReport {
	instances := make(map[string]*models.Instance, len(rawInstances))
	for key, value := range rawInstances {
		id := strings.TrimPrefix(key, models.KeyPrefixInstances)
		var instance models.Instance
		if json.Unmarshal(value, &instance) == nil && instance.AdminAPIURL != "" {
			instances[id] = &instance
		} else {
			instances[id] = nil
		}
	}

	wanted := map[string]map[string]bool{}
	for key := range records {
		instanceID, resourceType, _, ok := parseOwnershipKey(key)
		if !ok || !models.TeamScopedResources[resourceType] {
			continue
		}
		if _, exists := instances[instanceID]; !exists {
			continue
		}
		if scope != nil && !scope(instanceID, resourceType) {
			continue
		}
		if wanted[instanceID] == nil {
			wanted[instanceID] = map[string]bool{}
		}
		wanted[instanceID][resourceType] = true
	}

	report := &OwnershipReport{Unchecked: []UncheckedInstance{}}
	present := map[string]map[string]map[string]bool{}
	uncheckedInstances := map[string]bool{}
	for _, instanceID := range sortedKeys(wanted) {
		instance := instances[instanceID]
		switch {
		case instance == nil:
			report.Unchecked = append(report.Unchecked, UncheckedInstance{InstanceID: instanceID, Reason: "its record could not be read"})
			uncheckedInstances[instanceID] = true
			continue
		case !instance.IsActive:
			report.Unchecked = append(report.Unchecked, UncheckedInstance{InstanceID: instanceID, Reason: "inactive"})
			uncheckedInstances[instanceID] = true
			continue
		}
		present[instanceID] = map[string]map[string]bool{}
		for _, resourceType := range sortedKeys(wanted[instanceID]) {
			ids, err := lister.ListResourceIDs(ctx, instance, resourceType)
			if errors.Is(err, errGatewayUnreachable) {
				report.Unchecked = append(report.Unchecked, UncheckedInstance{
					InstanceID: instanceID,
					Reason:     err.Error(),
				})
				uncheckedInstances[instanceID] = true
				delete(present, instanceID)
				break
			}
			if err != nil {
				report.Unchecked = append(report.Unchecked, UncheckedInstance{
					InstanceID:   instanceID,
					ResourceType: resourceType,
					Reason:       fmt.Sprintf("could not be listed: %v", err),
				})
				continue
			}
			present[instanceID][resourceType] = ids
		}
	}

	known := make(map[string]bool, len(instances))
	for id := range instances {
		known[id] = true
	}
	report.Orphans = orphanedOwnership(records, known, present, uncheckedInstances)
	return report
}

// orphanedOwnership decides which records have nothing left to own, given the
// raw records, the instances that exist, the resource ids each gateway listed
// per type, and the instances not asked at all. A record for a shared type is
// judged only against a list its gateway gave for that type.
func orphanedOwnership(records map[string][]byte, instances map[string]bool, present map[string]map[string]map[string]bool, uncheckedInstances map[string]bool) []OrphanedOwnership {
	orphans := []OrphanedOwnership{}
	for key, value := range records {
		instanceID, resourceType, resourceID, ok := parseOwnershipKey(key)
		if !ok {
			continue
		}
		orphan := OrphanedOwnership{Key: key, InstanceID: instanceID, ResourceType: resourceType, ResourceID: resourceID}
		var teamID string
		if json.Unmarshal(value, &teamID) == nil {
			orphan.TeamID = teamID
		}

		switch {
		case !instances[instanceID]:
			orphan.Reason = OwnershipInstanceGone
		case !models.TeamScopedResources[resourceType]:
			orphan.Reason = OwnershipTypeNotShared
		case uncheckedInstances[instanceID]:
			continue
		default:
			ids, listed := present[instanceID][resourceType]
			if !listed || ids[resourceID] {
				continue
			}
			orphan.Reason = OwnershipResourceGone
		}
		orphans = append(orphans, orphan)
	}
	sort.Slice(orphans, func(i, j int) bool { return orphans[i].Key < orphans[j].Key })
	return orphans
}

// parseOwnershipKey splits /ownership/<instance>/<type>/<id>.
func parseOwnershipKey(key string) (instanceID, resourceType, resourceID string, ok bool) {
	parts := strings.SplitN(strings.TrimPrefix(key, models.KeyPrefixOwnership), "/", 3)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
