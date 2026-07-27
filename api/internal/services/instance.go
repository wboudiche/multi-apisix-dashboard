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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"

	"github.com/google/uuid"
)

// ErrDuplicateInstanceName is returned when a create/update would leave two
// instances sharing a name. Names are compared case-insensitively so the list
// never shows two visually identical rows.
var ErrDuplicateInstanceName = errors.New("an instance with this name already exists")

type InstanceService struct {
	etcd *EtcdClient
}

func NewInstanceService(etcd *EtcdClient) *InstanceService {
	return &InstanceService{etcd: etcd}
}

// NormalizeInstanceName returns the form used to compare instance names.
func NormalizeInstanceName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// NormalizeAdminAPIURL collapses the cosmetic differences between two spellings
// of the same Admin API endpoint (trailing slashes, scheme/host casing, an
// explicitly written default port) so they compare equal.
func NormalizeAdminAPIURL(raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return strings.ToLower(trimmed)
	}

	parsed.Scheme = strings.ToLower(parsed.Scheme)
	host := strings.ToLower(parsed.Host)
	switch {
	case parsed.Scheme == "http" && strings.HasSuffix(host, ":80"):
		host = strings.TrimSuffix(host, ":80")
	case parsed.Scheme == "https" && strings.HasSuffix(host, ":443"):
		host = strings.TrimSuffix(host, ":443")
	}
	parsed.Host = host

	return parsed.String()
}

// FindInstanceByName returns the instance whose name collides with candidate,
// or nil. excludeID lets an update ignore the record being updated.
// An empty candidate never collides.
func FindInstanceByName(instances []*models.Instance, candidate string, excludeID string) *models.Instance {
	normalized := NormalizeInstanceName(candidate)
	if normalized == "" {
		return nil
	}
	for _, instance := range instances {
		if instance == nil || instance.ID == excludeID {
			continue
		}
		if NormalizeInstanceName(instance.Name) == normalized {
			return instance
		}
	}
	return nil
}

// FindInstanceByAdminAPIURL returns the instance already pointing at the same
// Admin API endpoint as candidate, or nil. Unlike names this is not an error -
// two instances may legitimately address one gateway with different admin keys -
// so callers use it to warn rather than to reject.
func FindInstanceByAdminAPIURL(instances []*models.Instance, candidate string, excludeID string) *models.Instance {
	normalized := NormalizeAdminAPIURL(candidate)
	if normalized == "" {
		return nil
	}
	for _, instance := range instances {
		if instance == nil || instance.ID == excludeID {
			continue
		}
		if NormalizeAdminAPIURL(instance.AdminAPIURL) == normalized {
			return instance
		}
	}
	return nil
}

// FindNameConflict reports whether another instance already uses the given name.
func (s *InstanceService) FindNameConflict(ctx context.Context, name string, excludeID string) (*models.Instance, error) {
	instances, err := s.ListInstances(ctx)
	if err != nil {
		return nil, err
	}
	return FindInstanceByName(instances, name, excludeID), nil
}

// FindAdminAPIURLConflict reports whether another instance already uses the
// given Admin API URL.
func (s *InstanceService) FindAdminAPIURLConflict(ctx context.Context, adminAPIURL string, excludeID string) (*models.Instance, error) {
	instances, err := s.ListInstances(ctx)
	if err != nil {
		return nil, err
	}
	return FindInstanceByAdminAPIURL(instances, adminAPIURL, excludeID), nil
}

// CreateInstance persists a new instance, rejecting a name already in use.
//
// The uniqueness check is read-then-write rather than an etcd transaction. Only
// super_admins create instances, so a racing duplicate is unlikely; if that ever
// changes this needs a compare-and-swap on a name-index key.
func (s *InstanceService) CreateInstance(ctx context.Context, instance *models.Instance) error {
	existing, err := s.ListInstances(ctx)
	if err != nil {
		return err
	}
	if conflict := FindInstanceByName(existing, instance.Name, ""); conflict != nil {
		return ErrDuplicateInstanceName
	}

	instance.Name = strings.TrimSpace(instance.Name)
	instance.ID = uuid.New().String()
	instance.CreatedAt = time.Now()
	instance.UpdatedAt = time.Now()
	return s.etcd.PutJSON(ctx, models.KeyPrefixInstances+instance.ID, instance)
}

func (s *InstanceService) GetInstance(ctx context.Context, id string) (*models.Instance, error) {
	var instance models.Instance
	err := s.etcd.GetJSON(ctx, models.KeyPrefixInstances+id, &instance)
	if err != nil {
		return nil, err
	}
	if instance.ID == "" {
		return nil, nil
	}
	return &instance, nil
}

func (s *InstanceService) ListInstances(ctx context.Context) ([]*models.Instance, error) {
	instancesData, err := s.etcd.List(ctx, models.KeyPrefixInstances)
	if err != nil {
		return nil, err
	}

	instances := make([]*models.Instance, 0, len(instancesData))
	for _, data := range instancesData {
		var instance models.Instance
		if err := json.Unmarshal(data, &instance); err != nil {
			continue
		}
		instances = append(instances, &instance)
	}

	return instances, nil
}

// UpdateInstance persists changes to an instance, rejecting a rename onto a
// name another instance already holds.
func (s *InstanceService) UpdateInstance(ctx context.Context, instance *models.Instance) error {
	existing, err := s.ListInstances(ctx)
	if err != nil {
		return err
	}
	if conflict := FindInstanceByName(existing, instance.Name, instance.ID); conflict != nil {
		return ErrDuplicateInstanceName
	}

	instance.Name = strings.TrimSpace(instance.Name)
	instance.UpdatedAt = time.Now()
	return s.etcd.PutJSON(ctx, models.KeyPrefixInstances+instance.ID, instance)
}

// GetInstanceDependencies reports everything that still references the instance:
// the resources living on its gateway plus the dashboard's own records that
// point at it. Used to describe the blast radius before a delete.
func (s *InstanceService) GetInstanceDependencies(ctx context.Context, instance *models.Instance) (*models.InstanceDependencies, error) {
	deps := &models.InstanceDependencies{}

	// Gateway-side resources. A single failing probe means the Admin API is not
	// answering, so every count is unknown rather than zero.
	counts := map[string]*int{
		"routes":        &deps.Routes,
		"services":      &deps.Services,
		"upstreams":     &deps.Upstreams,
		"consumers":     &deps.Consumers,
		"stream_routes": &deps.StreamRoutes,
	}
	deps.Reachable = true
	for resource, target := range counts {
		count, err := s.countAdminResource(ctx, instance, resource)
		if err != nil {
			deps.Reachable = false
			break
		}
		*target = count
	}
	if !deps.Reachable {
		deps.Routes, deps.Services, deps.Upstreams, deps.Consumers, deps.StreamRoutes = 0, 0, 0, 0, 0
	}

	// Dashboard-side records that would be orphaned.
	userAssignments, err := s.etcd.List(ctx, models.KeyPrefixUserInstances)
	if err != nil {
		return nil, err
	}
	for key := range userAssignments {
		if strings.HasSuffix(key, "/"+instance.ID) {
			deps.UserAssignments++
		}
	}

	ownership, err := s.etcd.List(ctx, models.KeyPrefixOwnership+instance.ID+"/")
	if err != nil {
		return nil, err
	}
	deps.OwnershipRecords = len(ownership)

	return deps, nil
}

// countAdminResource returns how many resources of the given type the instance's
// Admin API reports. An error means the Admin API could not be read at all.
func (s *InstanceService) countAdminResource(ctx context.Context, instance *models.Instance, resource string) (int, error) {
	targetURL := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin/" + resource

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return 0, err
	}
	if instance.AdminKey != "" {
		req.Header.Set("X-API-Key", instance.AdminKey)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("APISIX returned status %d for %s", resp.StatusCode, resource)
	}

	var body struct {
		Total int `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		// The endpoint answered, so the instance is reachable; treat an
		// unreadable body as "no resources of this type".
		return 0, nil
	}
	return body.Total, nil
}

// DeleteInstance removes the instance together with the dashboard records that
// point at it. Without this cascade the /ownership/<instanceID>/... and
// /user_instances/<userID>/<instanceID> keys would linger in etcd forever.
//
// Resources on the gateway itself are deliberately left alone - they stay live
// on APISIX and are not the dashboard's to destroy. Callers are expected to have
// surfaced GetInstanceDependencies to the operator first.
func (s *InstanceService) DeleteInstance(ctx context.Context, id string) error {
	if err := s.etcd.DeletePrefix(ctx, models.KeyPrefixOwnership+id+"/"); err != nil {
		return err
	}

	userAssignments, err := s.etcd.List(ctx, models.KeyPrefixUserInstances)
	if err != nil {
		return err
	}
	for key := range userAssignments {
		if strings.HasSuffix(key, "/"+id) {
			if err := s.etcd.Delete(ctx, key); err != nil {
				return err
			}
		}
	}

	return s.etcd.Delete(ctx, models.KeyPrefixInstances+id)
}

// TestConnection tests if an instance is reachable via Admin API
func (s *InstanceService) TestConnection(ctx context.Context, instance *models.Instance) error {
	if instance.AdminAPIURL == "" {
		return fmt.Errorf("admin API URL is empty")
	}

	targetURL := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin/services"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	if instance.AdminKey != "" {
		req.Header.Set("X-API-Key", instance.AdminKey)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("APISIX returned status %d", resp.StatusCode)
	}

	return nil
}

func NewEtcdClientFromEndpoint(endpoint string) (*EtcdClient, error) {
	// This is a simple wrapper for testing connection
	// In production, you'd want proper TLS and authentication
	return &EtcdClient{}, nil
}

// CheckConnection is a placeholder for instance connectivity testing
func (e *EtcdClient) TestInstanceConnection(ctx context.Context, endpoint string) error {
	// Placeholder - implement actual connection test
	return nil
}
