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
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

func TestNormalizeAdminAPIURL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"plain", "http://127.0.0.1:9180", "http://127.0.0.1:9180"},
		{"trailing slash", "http://127.0.0.1:9180/", "http://127.0.0.1:9180"},
		{"many trailing slashes", "http://127.0.0.1:9180///", "http://127.0.0.1:9180"},
		{"surrounding space", "  http://127.0.0.1:9180  ", "http://127.0.0.1:9180"},
		{"uppercase scheme and host", "HTTP://LocalHost:9180", "http://localhost:9180"},
		{"default http port dropped", "http://example.com:80", "http://example.com"},
		{"default https port dropped", "https://example.com:443", "https://example.com"},
		{"non-default port kept", "https://example.com:9180", "https://example.com:9180"},
		{"path preserved", "http://example.com/apisix", "http://example.com/apisix"},
		{"empty", "", ""},
		{"unparseable falls back to lowercase", "://nonsense", "://nonsense"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeAdminAPIURL(tt.input); got != tt.expected {
				t.Errorf("NormalizeAdminAPIURL(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestFindInstanceByName(t *testing.T) {
	existing := []*models.Instance{
		{ID: "id-1", Name: "APISIX2"},
		{ID: "id-2", Name: "Production Cluster"},
	}

	tests := []struct {
		name      string
		candidate string
		excludeID string
		wantID    string // "" means no conflict expected
	}{
		{"exact match", "APISIX2", "", "id-1"},
		{"different case", "apisix2", "", "id-1"},
		{"mixed case", "ApIsIx2", "", "id-1"},
		{"surrounding whitespace", "  APISIX2  ", "", "id-1"},
		{"name with inner space", "production cluster", "", "id-2"},
		{"no conflict", "Staging", "", ""},
		{"self excluded on update", "APISIX2", "id-1", ""},
		{"other instance still conflicts", "APISIX2", "id-2", "id-1"},
		{"empty candidate never conflicts", "", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FindInstanceByName(existing, tt.candidate, tt.excludeID)
			if tt.wantID == "" {
				if got != nil {
					t.Errorf("FindInstanceByName(%q, exclude=%q) = %q, want no conflict", tt.candidate, tt.excludeID, got.ID)
				}
				return
			}
			if got == nil {
				t.Fatalf("FindInstanceByName(%q, exclude=%q) = nil, want %q", tt.candidate, tt.excludeID, tt.wantID)
			}
			if got.ID != tt.wantID {
				t.Errorf("FindInstanceByName(%q, exclude=%q) = %q, want %q", tt.candidate, tt.excludeID, got.ID, tt.wantID)
			}
		})
	}
}

func TestFindInstanceByAdminAPIURL(t *testing.T) {
	existing := []*models.Instance{
		{ID: "id-1", Name: "APISIX2", AdminAPIURL: "http://127.0.0.1:9181"},
		{ID: "id-2", Name: "Prod", AdminAPIURL: "https://gw.example.com"},
	}

	tests := []struct {
		name      string
		candidate string
		excludeID string
		wantID    string
	}{
		{"exact match", "http://127.0.0.1:9181", "", "id-1"},
		{"trailing slash still matches", "http://127.0.0.1:9181/", "", "id-1"},
		{"default port still matches", "https://gw.example.com:443", "", "id-2"},
		{"different port is not a conflict", "http://127.0.0.1:9182", "", ""},
		{"self excluded on update", "http://127.0.0.1:9181", "id-1", ""},
		{"empty candidate never conflicts", "", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FindInstanceByAdminAPIURL(existing, tt.candidate, tt.excludeID)
			if tt.wantID == "" {
				if got != nil {
					t.Errorf("FindInstanceByAdminAPIURL(%q, exclude=%q) = %q, want no conflict", tt.candidate, tt.excludeID, got.ID)
				}
				return
			}
			if got == nil {
				t.Fatalf("FindInstanceByAdminAPIURL(%q, exclude=%q) = nil, want %q", tt.candidate, tt.excludeID, tt.wantID)
			}
			if got.ID != tt.wantID {
				t.Errorf("FindInstanceByAdminAPIURL(%q, exclude=%q) = %q, want %q", tt.candidate, tt.excludeID, got.ID, tt.wantID)
			}
		})
	}
}

func TestInstanceDependenciesRequiresConfirmation(t *testing.T) {
	tests := []struct {
		name string
		deps models.InstanceDependencies
		want bool
	}{
		{"reachable and empty", models.InstanceDependencies{Reachable: true}, false},
		{"routes attached", models.InstanceDependencies{Reachable: true, Routes: 1}, true},
		{"services attached", models.InstanceDependencies{Reachable: true, Services: 3}, true},
		{"upstreams attached", models.InstanceDependencies{Reachable: true, Upstreams: 2}, true},
		{"consumers attached", models.InstanceDependencies{Reachable: true, Consumers: 1}, true},
		{"stream routes attached", models.InstanceDependencies{Reachable: true, StreamRoutes: 1}, true},
		{"user assignments only", models.InstanceDependencies{Reachable: true, UserAssignments: 1}, true},
		{"ownership records only", models.InstanceDependencies{Reachable: true, OwnershipRecords: 1}, true},
		// When the gateway cannot be reached its resource counts are unknown, so
		// deleting is never safe to do silently.
		{"unreachable and otherwise empty", models.InstanceDependencies{Reachable: false}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.deps.RequiresConfirmation(); got != tt.want {
				t.Errorf("RequiresConfirmation() = %v, want %v (deps: %+v)", got, tt.want, tt.deps)
			}
		})
	}
}

func TestInstanceDependenciesTotalGatewayResources(t *testing.T) {
	deps := models.InstanceDependencies{
		Reachable:    true,
		Routes:       2,
		Services:     3,
		Upstreams:    4,
		Consumers:    5,
		StreamRoutes: 6,
		// Not gateway resources - must not be counted.
		UserAssignments:  7,
		OwnershipRecords: 8,
	}
	if got, want := deps.TotalGatewayResources(), 20; got != want {
		t.Errorf("TotalGatewayResources() = %d, want %d", got, want)
	}
}
