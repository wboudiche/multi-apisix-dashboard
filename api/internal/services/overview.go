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
	"sync"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

type OverviewService struct {
	instanceService  *InstanceService
	ownershipService *OwnershipService
	client           *http.Client
	cache            map[string]models.InstanceHealth
	cachedStats      models.ResourceStats
	cacheExpiry      time.Time
	mu               sync.RWMutex
}

func NewOverviewService(instanceService *InstanceService, ownershipService *OwnershipService) *OverviewService {
	return &OverviewService{
		instanceService:  instanceService,
		ownershipService: ownershipService,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
		cache: make(map[string]models.InstanceHealth),
	}
}

func (s *OverviewService) GetOverview(ctx context.Context, userID string, globalRole string, teamID string) (*models.OverviewData, error) {
	s.mu.RLock()
	if time.Now().Before(s.cacheExpiry) && len(s.cache) > 0 {
		data := s.buildOverviewFromCache()
		s.mu.RUnlock()
		return data, nil
	}
	s.mu.RUnlock()

	return s.RefreshOverview(ctx, userID, globalRole, teamID)
}

func (s *OverviewService) RefreshOverview(ctx context.Context, userID string, globalRole string, teamID string) (*models.OverviewData, error) {
	instances, err := s.instanceService.ListInstances(ctx)
	if err != nil {
		return nil, err
	}

	var wg sync.WaitGroup
	newCache := make(map[string]models.InstanceHealth)
	var mu sync.Mutex
	var totalRoutes, totalServices, totalUpstreams int

	for _, inst := range instances {
		wg.Add(1)
		go func(instance *models.Instance) {
			defer wg.Done()

			health := models.InstanceHealth{
				InstanceID: instance.ID,
				Name:       instance.Name,
				Status:     "Connected",
				LastCheck:  time.Now(),
			}

			// Fetch resource counts from the instance
			routes := s.fetchResourceCount(ctx, instance, "/apisix/admin/routes")
			services := s.fetchResourceCount(ctx, instance, "/apisix/admin/services")
			upstreams := s.fetchResourceCount(ctx, instance, "/apisix/admin/upstreams")

			if routes < 0 && services < 0 && upstreams < 0 {
				health.Status = "Disconnected"
				health.Error = "Failed to reach admin API"
			}

			mu.Lock()
			newCache[instance.ID] = health
			if routes > 0 {
				totalRoutes += routes
			}
			if services > 0 {
				totalServices += services
			}
			if upstreams > 0 {
				totalUpstreams += upstreams
			}
			mu.Unlock()
		}(inst)
	}

	wg.Wait()

	s.mu.Lock()
	s.cache = newCache
	s.cachedStats = models.ResourceStats{
		Routes:    totalRoutes,
		Services:  totalServices,
		Upstreams: totalUpstreams,
	}
	s.cacheExpiry = time.Now().Add(30 * time.Second)
	data := s.buildOverviewFromCache()
	s.mu.Unlock()

	return data, nil
}

func (s *OverviewService) fetchResourceCount(ctx context.Context, instance *models.Instance, path string) int {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s%s", instance.AdminAPIURL, path), nil)
	if err != nil {
		return -1
	}
	req.Header.Set("X-API-Key", instance.AdminKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return -1
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return -1
	}

	var result struct {
		Total int `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0
	}
	return result.Total
}

func (s *OverviewService) buildOverviewFromCache() *models.OverviewData {
	data := &models.OverviewData{
		TotalInstances: len(s.cache),
		AllInstances:   make([]models.InstanceHealth, 0, len(s.cache)),
		GlobalStats:    s.cachedStats,
	}

	for _, health := range s.cache {
		data.AllInstances = append(data.AllInstances, health)
		if health.Status == "Connected" {
			data.ActiveInstances++
		}
	}

	return data
}
