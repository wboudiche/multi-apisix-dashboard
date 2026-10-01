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
	"encoding/json"
	"reflect"
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// A role recorded here that nothing honours is worse than a rejection: the
// assignment looks made, while HasResourcePermission denies every resource for
// an unrecognised role, so the user silently ends up able to do nothing.
func TestIsAssignableInstanceRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{models.RoleInstanceAdmin, true},
		{models.RoleDeveloper, true},
		{models.RoleViewer, true},
		// Global, read from the JWT and never narrowed by an instance
		// assignment — recording it per instance describes nothing real.
		{models.RoleSuperAdmin, false},
		{"", false},
		{"wizard", false},
		{"Developer", false},
		{" developer", false},
	}

	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			if got := isAssignableInstanceRole(tt.role); got != tt.want {
				t.Errorf("isAssignableInstanceRole(%q) = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}

// An assignment takes a list of teams (#301). A client from before the list
// sends one team under the old name, and is still understood: the e2e seeding
// and the Users page of the release before this one both do.
func TestAssignmentRequestTeams(t *testing.T) {
	cases := []struct {
		name string
		body string
		want []string
	}{
		{"a list", `{"role":"developer","team_ids":["t1","t2"]}`, []string{"t1", "t2"}},
		{"one team, the old name", `{"role":"developer","team_id":"t1"}`, []string{"t1"}},
		{"both: the list counts", `{"role":"developer","team_ids":["t2","t3"],"team_id":"t1"}`, []string{"t2", "t3"}},
		{"neither", `{"role":"instance_admin"}`, []string{}},
		{"an empty old name", `{"role":"instance_admin","team_id":""}`, []string{}},
		{"repeats and blanks", `{"role":"viewer","team_ids":["t1","","t1"]}`, []string{"t1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var req SetUserInstanceRoleRequest
			if err := json.Unmarshal([]byte(tc.body), &req); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got := req.teams(); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("teams() = %#v, want %#v", got, tc.want)
			}
		})
	}
}

// For a developer or a viewer the teams are the whole of what they can see, so
// an assignment with none is an account that can do nothing. An instance admin
// is not tied to a team.
func TestRoleNeedsTeam(t *testing.T) {
	for role, want := range map[string]bool{
		models.RoleDeveloper:     true,
		models.RoleViewer:        true,
		models.RoleInstanceAdmin: false,
	} {
		if got := roleNeedsTeam(role); got != want {
			t.Errorf("roleNeedsTeam(%q) = %v, want %v", role, got, want)
		}
	}
}
