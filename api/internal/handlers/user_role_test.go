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

package handlers

import (
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// The global Role field is reserved for super_admin, or empty for users whose
// effective role comes entirely from per-instance assignments. Anything else
// gets baked into a JWT and bypasses per-instance RBAC, so only these two values
// may ever be written.
func TestIsAssignableGlobalRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{models.RoleSuperAdmin, true},
		{"", true},
		{models.RoleInstanceAdmin, false},
		{models.RoleDeveloper, false},
		{models.RoleViewer, false},
		{"admin", false},
		{"SUPER_ADMIN", false},
		{" super_admin", false},
	}

	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			if got := isAssignableGlobalRole(tt.role); got != tt.want {
				t.Errorf("isAssignableGlobalRole(%q) = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}

// Demoting the only super_admin leaves nobody able to manage instances, users or
// ownership — a state only reachable back out of by editing etcd directly.
func TestWouldRemoveLastSuperAdmin(t *testing.T) {
	only := []*models.User{
		{ID: "a", Username: "admin", Role: models.RoleSuperAdmin},
		{ID: "b", Username: "dev"},
	}
	two := []*models.User{
		{ID: "a", Username: "admin", Role: models.RoleSuperAdmin},
		{ID: "b", Username: "admin2", Role: models.RoleSuperAdmin},
	}

	tests := []struct {
		name    string
		users   []*models.User
		target  string
		newRole string
		want    bool
	}{
		{"demoting the only super_admin", only, "a", "", true},
		{"promoting someone else while one exists", only, "b", models.RoleSuperAdmin, false},
		{"demoting one of two", two, "a", "", false},
		{"re-saving the only super_admin as super_admin", only, "a", models.RoleSuperAdmin, false},
		{"editing an unrelated user", only, "b", "", false},
		{"target not in the list", only, "missing", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := wouldRemoveLastSuperAdmin(tt.users, tt.target, tt.newRole)
			if got != tt.want {
				t.Errorf("wouldRemoveLastSuperAdmin(target=%q, newRole=%q) = %v, want %v",
					tt.target, tt.newRole, got, tt.want)
			}
		})
	}
}
