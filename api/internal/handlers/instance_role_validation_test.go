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
	"strings"
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
// sends one team under the old name, and is still understood - as that one
// team: the e2e seeding relies on it to put an account back on a known team.
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
		// What a client sends that read an assignment, emptied its list and
		// saved the object back: no team, whatever the old name still says.
		{"an empty list beside the old name", `{"role":"instance_admin","team_ids":[],"team_id":"t1"}`, []string{}},
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

// The access list answers each assignment with the teams it holds that still
// exist, by name: what a developer with several is offered to choose between,
// beside the ids and the role it is checked against (#301).
func TestAssignmentWithTeams(t *testing.T) {
	names := map[string]string{"t1": "Payments", "t2": "Checkout"}
	ui := &models.UserInstance{
		UserID: "u", InstanceID: "i", Role: models.RoleDeveloper,
		// t9 was deleted since: still named by the assignment (#375).
		TeamIDs: []string{"t2", "t9", "t1"},
	}

	out, err := json.Marshal(assignmentWithTeams(ui, names))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var got struct {
		UserID     string     `json:"user_id"`
		InstanceID string     `json:"instance_id"`
		Role       string     `json:"role"`
		TeamIDs    []string   `json:"team_ids"`
		TeamID     string     `json:"team_id"`
		Teams      []teamName `json:"teams"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("decode %s: %v", out, err)
	}

	// The record, as it is answered everywhere else.
	if got.UserID != "u" || got.InstanceID != "i" || got.Role != models.RoleDeveloper || got.TeamID != "t2" {
		t.Errorf("the record: %s", out)
	}
	if !reflect.DeepEqual(got.TeamIDs, []string{"t2", "t9", "t1"}) {
		t.Errorf("team_ids %v: every id the assignment holds, the deleted one too", got.TeamIDs)
	}
	// The teams that exist, in the assignment's order.
	want := []teamName{{ID: "t2", Name: "Checkout", Role: models.RoleDeveloper}, {ID: "t1", Name: "Payments", Role: models.RoleDeveloper}}
	if !reflect.DeepEqual(got.Teams, want) {
		t.Errorf("teams %v, want %v", got.Teams, want)
	}

	// A list, not null, for an assignment with no team.
	out, _ = json.Marshal(assignmentWithTeams(&models.UserInstance{Role: models.RoleInstanceAdmin}, names))
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(out, &raw)
	if string(raw["teams"]) != "[]" {
		t.Errorf("teams %s, want []", raw["teams"])
	}

	// And no field at all when the teams were not read: no names is not "no
	// teams", and the reader must be able to tell.
	out, _ = json.Marshal(assignmentWithTeams(ui, nil))
	raw = nil
	_ = json.Unmarshal(out, &raw)
	if _, named := raw["teams"]; named {
		t.Errorf("teams %s, want the field left out", raw["teams"])
	}
	if string(raw["role"]) != `"developer"` || string(raw["team_ids"]) != `["t2","t9","t1"]` {
		t.Errorf("the record without its names: %s", out)
	}
}

// A role per team: team_roles names a role for some of the request's teams,
// and the rest take role. The stored role is the strongest of them.
func TestAssignmentRequestRoles(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantRoles map[string]string
		wantRole  string
		wantErr   string
	}{
		{"no team_roles: every team has role",
			`{"role":"developer","team_ids":["t1","t2"]}`,
			map[string]string{"t1": "developer", "t2": "developer"}, "developer", ""},
		{"a role per team",
			`{"role":"viewer","team_ids":["t1","t2"],"team_roles":{"t2":"developer"}}`,
			map[string]string{"t1": "viewer", "t2": "developer"}, "developer", ""},
		{"every team a viewer",
			`{"role":"developer","team_ids":["t1"],"team_roles":{"t1":"viewer"}}`,
			map[string]string{"t1": "viewer"}, "viewer", ""},
		{"the old single team takes role",
			`{"role":"viewer","team_id":"t1"}`,
			map[string]string{"t1": "viewer"}, "viewer", ""},
		{"an instance admin",
			`{"role":"instance_admin"}`, nil, "instance_admin", ""},
		{"a team the request does not hold",
			`{"role":"developer","team_ids":["t1"],"team_roles":{"t9":"viewer"}}`,
			nil, "", "t9"},
		{"a role a team cannot hold",
			`{"role":"developer","team_ids":["t1"],"team_roles":{"t1":"instance_admin"}}`,
			nil, "", "developer or viewer"},
		{"team roles for an instance admin",
			`{"role":"instance_admin","team_ids":["t1"],"team_roles":{"t1":"developer"}}`,
			nil, "", "instance admin"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var req SetUserInstanceRoleRequest
			if err := json.Unmarshal([]byte(tc.body), &req); err != nil {
				t.Fatalf("decode: %v", err)
			}
			_, roles, role, err := req.assignment()
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err %v, want one mentioning %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("err %v", err)
			}
			if !reflect.DeepEqual(roles, tc.wantRoles) || role != tc.wantRole {
				t.Errorf("got %#v / %q, want %#v / %q", roles, role, tc.wantRoles, tc.wantRole)
			}
		})
	}
}

// The teams of an answer say the role in each: the only place a developer or
// a viewer learns which of their teams they may change.
func TestAssignmentWithTeamsNamesTheRoleInEach(t *testing.T) {
	ui := &models.UserInstance{TeamIDs: []string{"t1", "t2"}, Role: models.RoleDeveloper,
		TeamRoles: map[string]string{"t1": models.RoleViewer, "t2": models.RoleDeveloper}}
	out, err := json.Marshal(assignmentWithTeams(ui, map[string]string{"t1": "One", "t2": "Two"}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `{"id":"t1","name":"One","role":"viewer"}`) ||
		!strings.Contains(string(out), `{"id":"t2","name":"Two","role":"developer"}`) {
		t.Errorf("teams without their roles: %s", out)
	}
}
