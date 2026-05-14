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
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"

	"github.com/google/uuid"
)

type InstanceService struct {
	etcd *EtcdClient
}

func NewInstanceService(etcd *EtcdClient) *InstanceService {
	return &InstanceService{etcd: etcd}
}

func (s *InstanceService) CreateInstance(ctx context.Context, instance *models.Instance) error {
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

func (s *InstanceService) UpdateInstance(ctx context.Context, instance *models.Instance) error {
	instance.UpdatedAt = time.Now()
	return s.etcd.PutJSON(ctx, models.KeyPrefixInstances+instance.ID, instance)
}

func (s *InstanceService) DeleteInstance(ctx context.Context, id string) error {
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
