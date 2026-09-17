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

// ErrNoInstancesRead is returned when ownership records exist but no instance
// could be read. Deleting an instance removes its records, so the two never
// part ways that completely; judged against it every record would look
// orphaned.
var ErrNoInstancesRead = errors.New("ownership records exist but no instances could be read; refusing to judge them")

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

// UncheckedInstance is an instance whose records were not judged, because its
// gateway could not say which resources it holds.
type UncheckedInstance struct {
	InstanceID string `json:"instance_id"`
	Reason     string `json:"reason"`
}

// OwnershipReport is what a sweep of the ownership records found.
type OwnershipReport struct {
	Orphans   []OrphanedOwnership `json:"orphans"`
	Unchecked []UncheckedInstance `json:"unchecked_instances"`
}

// resourceLister reads the id of every resource of a type on an instance.
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
		return nil, err
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
		Value struct {
			ID       string `json:"id"`
			Username string `json:"username"`
		} `json:"value"`
	}
	if err := json.Unmarshal(trimmed, &rows); err != nil {
		return nil, fmt.Errorf("unreadable list: %w", err)
	}
	for _, row := range rows {
		// Consumers are keyed by username; everything else by id.
		id := row.Value.ID
		if id == "" {
			id = row.Value.Username
		}
		if id != "" {
			ids[id] = true
		}
	}
	return ids, nil
}

// FindOrphanedOwnership lists the ownership records nothing is left to own.
// Deleting a resource removes its record since #249; the ones left before that
// still count against their team and reserve their id (#248).
func (s *MaintenanceService) FindOrphanedOwnership(ctx context.Context) (*OwnershipReport, error) {
	report, _, err := s.readOrphanedOwnership(ctx)
	return report, err
}

// readOrphanedOwnership also returns every record it read, so a purge can tell
// a record that is not orphaned from one that is not there at all.
func (s *MaintenanceService) readOrphanedOwnership(ctx context.Context) (*OwnershipReport, map[string][]byte, error) {
	// Records first, gateways after. A resource created in between has no
	// record in the first read to be misjudged; read the other way round, its
	// record would name a resource the gateway had not listed yet.
	records, err := s.etcd.List(ctx, models.KeyPrefixOwnership)
	if err != nil {
		return nil, nil, fmt.Errorf("could not read ownership records: %w", err)
	}
	rawInstances, err := s.etcd.List(ctx, models.KeyPrefixInstances)
	if err != nil {
		return nil, nil, fmt.Errorf("could not read instances: %w", err)
	}
	if len(rawInstances) == 0 && len(records) > 0 {
		return nil, nil, ErrNoInstancesRead
	}

	// An instance exists if its key does. One whose record does not parse is
	// still an instance; only its gateway cannot be asked.
	instances := make(map[string]*models.Instance, len(rawInstances))
	for key, value := range rawInstances {
		var instance models.Instance
		if json.Unmarshal(value, &instance) == nil && instance.AdminAPIURL != "" {
			instances[strings.TrimPrefix(key, models.KeyPrefixInstances)] = &instance
		} else {
			instances[strings.TrimPrefix(key, models.KeyPrefixInstances)] = nil
		}
	}

	// Ask each gateway only for the types its records name.
	wanted := map[string]map[string]bool{}
	for key := range records {
		instanceID, resourceType, _, ok := parseOwnershipKey(key)
		if _, exists := instances[instanceID]; !ok || !exists || !models.TeamScopedResources[resourceType] {
			continue
		}
		if wanted[instanceID] == nil {
			wanted[instanceID] = map[string]bool{}
		}
		wanted[instanceID][resourceType] = true
	}

	present := map[string]map[string]map[string]bool{}
	unchecked := map[string]string{}
	for instanceID, types := range wanted {
		instance := instances[instanceID]
		switch {
		case instance == nil:
			unchecked[instanceID] = "its record could not be read"
			continue
		case !instance.IsActive:
			unchecked[instanceID] = "inactive"
			continue
		}
		present[instanceID] = map[string]map[string]bool{}
		for _, resourceType := range sortedKeys(types) {
			ids, err := s.lister.ListResourceIDs(ctx, instance, resourceType)
			if err != nil {
				unchecked[instanceID] = fmt.Sprintf("%s could not be listed: %v", resourceType, err)
				delete(present, instanceID)
				break
			}
			present[instanceID][resourceType] = ids
		}
	}

	known := make(map[string]bool, len(instances))
	for id := range instances {
		known[id] = true
	}
	report := &OwnershipReport{
		Orphans:   orphanedOwnership(records, known, present, unchecked),
		Unchecked: []UncheckedInstance{},
	}
	for _, id := range sortedKeys(unchecked) {
		report.Unchecked = append(report.Unchecked, UncheckedInstance{InstanceID: id, Reason: unchecked[id]})
	}
	return report, records, nil
}

// PurgeOrphanedOwnership deletes the given record keys, each only if it is
// still orphaned when the purge runs.
func (s *MaintenanceService) PurgeOrphanedOwnership(ctx context.Context, keys []string) (*PurgeResult, error) {
	report, records, err := s.readOrphanedOwnership(ctx)
	if err != nil {
		return nil, err
	}
	orphaned := make(map[string]bool, len(report.Orphans))
	for _, o := range report.Orphans {
		orphaned[o.Key] = true
	}
	unchecked := make(map[string]bool, len(report.Unchecked))
	for _, u := range report.Unchecked {
		unchecked[u.InstanceID] = true
	}

	return s.purgeKeys(ctx, keys, orphaned, func(key string) string {
		if _, ok := records[key]; !ok {
			return "no such ownership record"
		}
		if instanceID, _, _, ok := parseOwnershipKey(key); ok && unchecked[instanceID] {
			return "its instance could not be checked"
		}
		return "its resource exists"
	}), nil
}

// orphanedOwnership decides which records have nothing left to own, given the
// raw records under /ownership/, the instances that exist, the resource ids
// each checked gateway listed per type, and the instances that could not be
// checked, whose records for shared types are not judged at all.
func orphanedOwnership(records map[string][]byte, instances map[string]bool, present map[string]map[string]map[string]bool, unchecked map[string]string) []OrphanedOwnership {
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
		case unchecked[instanceID] != "":
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
