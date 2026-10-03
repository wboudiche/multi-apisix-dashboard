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

package models

import (
	"encoding/json"
	"reflect"
	"testing"
)

// An assignment held one team until #301, and every record written before it
// is still in etcd in that shape. Nothing rewrites them: a record is read as
// it was written, and written back in the new shape the next time somebody
// saves it.
func TestUserInstanceReadsTheRecordsWrittenBeforeItHeldAList(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"one team, the old shape", `{"user_id":"u","instance_id":"i","team_id":"team-a","role":"developer"}`, []string{"team-a"}},
		{"no team, the old shape", `{"user_id":"u","instance_id":"i","team_id":"","role":"instance_admin"}`, []string{}},
		{"a list", `{"user_id":"u","instance_id":"i","team_ids":["team-a","team-b"],"role":"developer"}`, []string{"team-a", "team-b"}},
		// What this version writes: the list, and its first team under the old
		// name. The list is the one that counts.
		{"both", `{"team_ids":["team-a","team-b"],"team_id":"team-a","role":"developer"}`, []string{"team-a", "team-b"}},
		{"neither", `{"user_id":"u","instance_id":"i","role":"viewer"}`, []string{}},
		{"null list", `{"team_ids":null,"team_id":"team-a"}`, []string{"team-a"}},
		// A list that is there counts, empty or not.
		{"an empty list beside the old name", `{"team_ids":[],"team_id":"team-a"}`, []string{}},
		{"repeats and blanks", `{"team_ids":["team-a","","team-a","team-b"]}`, []string{"team-a", "team-b"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var ui UserInstance
			if err := json.Unmarshal([]byte(tc.in), &ui); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if !reflect.DeepEqual(ui.TeamIDs, tc.want) {
				t.Errorf("TeamIDs %#v, want %#v", ui.TeamIDs, tc.want)
			}
		})
	}
}

func TestUserInstanceKeepsTheRestOfTheRecord(t *testing.T) {
	var ui UserInstance
	in := `{"user_id":"u-1","instance_id":"i-1","team_id":"team-a","role":"developer"}`
	if err := json.Unmarshal([]byte(in), &ui); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ui.UserID != "u-1" || ui.InstanceID != "i-1" || ui.Role != RoleDeveloper {
		t.Errorf("got %+v", ui)
	}
}

// A scope from before #377 restricted nothing. A record holding one still
// reads, and writing the assignment back leaves it out.
func TestUserInstanceDropsAScope(t *testing.T) {
	var ui UserInstance
	in := `{"user_id":"u-1","instance_id":"i-1","team_ids":["team-a"],"role":"viewer","scope":{"tags":["x"],"path_prefixes":["/a"]}}`
	if err := json.Unmarshal([]byte(in), &ui); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ui.Role != RoleViewer || !reflect.DeepEqual(ui.TeamIDs, []string{"team-a"}) {
		t.Errorf("got %+v", ui)
	}
	out, err := json.Marshal(ui)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var written map[string]any
	if err := json.Unmarshal(out, &written); err != nil {
		t.Fatalf("decode written: %v", err)
	}
	if _, ok := written["scope"]; ok {
		t.Errorf("scope written back: %s", out)
	}
}

// The list is what is written. Its first team goes out as team_id too, for
// the dashboard that still reads one team and for a binary rolled back to
// before the list: both see a team the user does have, never one they do not.
func TestUserInstanceWritesTheListAndItsFirstTeam(t *testing.T) {
	cases := []struct {
		name      string
		teams     []string
		wantList  []any
		wantFirst string
	}{
		{"two teams", []string{"team-a", "team-b"}, []any{"team-a", "team-b"}, "team-a"},
		{"one team", []string{"team-a"}, []any{"team-a"}, "team-a"},
		// A list, not null: the reader on the other side indexes it.
		{"none", nil, []any{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// By value and by pointer: handlers return both.
			for _, v := range []any{
				UserInstance{UserID: "u", InstanceID: "i", Role: RoleDeveloper, TeamIDs: tc.teams},
				&UserInstance{UserID: "u", InstanceID: "i", Role: RoleDeveloper, TeamIDs: tc.teams},
			} {
				out, err := json.Marshal(v)
				if err != nil {
					t.Fatalf("encode: %v", err)
				}
				var got map[string]any
				if err := json.Unmarshal(out, &got); err != nil {
					t.Fatalf("decode %s: %v", out, err)
				}
				if !reflect.DeepEqual(got["team_ids"], tc.wantList) {
					t.Errorf("team_ids %#v, want %#v (%s)", got["team_ids"], tc.wantList, out)
				}
				if got["team_id"] != tc.wantFirst {
					t.Errorf("team_id %#v, want %q (%s)", got["team_id"], tc.wantFirst, out)
				}
				if got["user_id"] != "u" || got["instance_id"] != "i" || got["role"] != RoleDeveloper {
					t.Errorf("the rest of the record: %s", out)
				}
			}
		})
	}
}

func TestUserInstanceHasTeam(t *testing.T) {
	ui := UserInstance{TeamIDs: []string{"team-a", "team-b"}}
	for team, want := range map[string]bool{"team-a": true, "team-b": true, "team-c": false, "": false} {
		if got := ui.HasTeam(team); got != want {
			t.Errorf("HasTeam(%q) = %v, want %v", team, got, want)
		}
	}
	// No team is not a team: an assignment with none has no team named "".
	if (UserInstance{}).HasTeam("") {
		t.Error("an assignment with no team has the empty team")
	}
}

// A role per team (#role-per-team). A record from before it has one role for
// every team, and is read that way; a record that names a role per team is
// read as it says, and its role is the strongest of them.
func TestUserInstanceReadsARolePerTeam(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		wantRoles map[string]string
		wantRole  string
	}{
		{"before the roles: every team has the role",
			`{"team_ids":["a","b"],"role":"viewer"}`,
			map[string]string{"a": "viewer", "b": "viewer"}, "viewer"},
		{"a role per team",
			`{"team_ids":["a","b"],"team_roles":{"a":"viewer","b":"developer"},"role":"developer"}`,
			map[string]string{"a": "viewer", "b": "developer"}, "developer"},
		{"the role is recomputed, whatever was stored",
			`{"team_ids":["a","b"],"team_roles":{"a":"viewer","b":"viewer"},"role":"developer"}`,
			map[string]string{"a": "viewer", "b": "viewer"}, "viewer"},
		{"a team the roles leave out takes the role",
			`{"team_ids":["a","b"],"team_roles":{"a":"viewer"},"role":"developer"}`,
			map[string]string{"a": "viewer", "b": "developer"}, "developer"},
		{"a role for a team the list does not hold is dropped",
			`{"team_ids":["a"],"team_roles":{"a":"developer","x":"developer"},"role":"developer"}`,
			map[string]string{"a": "developer"}, "developer"},
		{"a value that is not a team role falls back to the role",
			`{"team_ids":["a"],"team_roles":{"a":"instance_admin"},"role":"viewer"}`,
			map[string]string{"a": "viewer"}, "viewer"},
		{"an instance admin has no team roles",
			`{"team_ids":["a"],"team_roles":{"a":"developer"},"role":"instance_admin"}`,
			nil, "instance_admin"},
		// Permitted before teams were required: it sees nothing team-owned,
		// and keeps its role so the viewer gate still applies.
		{"a developer with no team keeps the role",
			`{"team_ids":[],"role":"developer"}`,
			map[string]string{}, "developer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var ui UserInstance
			if err := json.Unmarshal([]byte(tc.in), &ui); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if !reflect.DeepEqual(ui.TeamRoles, tc.wantRoles) {
				t.Errorf("TeamRoles %#v, want %#v", ui.TeamRoles, tc.wantRoles)
			}
			if ui.Role != tc.wantRole {
				t.Errorf("Role %q, want %q", ui.Role, tc.wantRole)
			}
		})
	}
}

func TestUserInstanceWritesItsTeamRoles(t *testing.T) {
	ui := UserInstance{
		UserID: "u", InstanceID: "i", TeamIDs: []string{"a", "b"},
		TeamRoles: map[string]string{"a": "viewer", "b": "developer"}, Role: "viewer",
	}
	out, err := json.Marshal(ui)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(out, &got)
	if got["role"] != "developer" {
		t.Errorf("role %v, want the strongest, developer", got["role"])
	}
	if !reflect.DeepEqual(got["team_roles"], map[string]any{"a": "viewer", "b": "developer"}) {
		t.Errorf("team_roles %v", got["team_roles"])
	}

	admin := UserInstance{TeamIDs: []string{"a"}, TeamRoles: map[string]string{"a": "developer"}, Role: RoleInstanceAdmin}
	out, _ = json.Marshal(admin)
	got = map[string]any{}
	_ = json.Unmarshal(out, &got)
	if _, ok := got["team_roles"]; ok {
		t.Errorf("an instance admin was written with team_roles: %s", out)
	}
	if got["role"] != RoleInstanceAdmin {
		t.Errorf("role %v, want instance_admin", got["role"])
	}
}

// Built in code without TeamRoles - every test fixture before the roles - an
// assignment reads as a record from before them: its role in every team.
func TestRoleInFallsBackToTheRole(t *testing.T) {
	legacy := UserInstance{Role: RoleDeveloper, TeamIDs: []string{"a", "b"}}
	if got := legacy.RoleIn("b"); got != RoleDeveloper {
		t.Errorf("RoleIn(b) = %q, want developer", got)
	}
	if got := legacy.WritableTeams(); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Errorf("WritableTeams() = %#v", got)
	}

	mixed := UserInstance{Role: RoleDeveloper, TeamIDs: []string{"a", "b"},
		TeamRoles: map[string]string{"a": RoleViewer, "b": RoleDeveloper}}
	if got := mixed.RoleIn("a"); got != RoleViewer {
		t.Errorf("RoleIn(a) = %q, want viewer", got)
	}
	if got := mixed.RoleIn("x"); got != "" {
		t.Errorf("RoleIn(x) = %q, want none: not a team of theirs", got)
	}
	if got := mixed.WritableTeams(); !reflect.DeepEqual(got, []string{"b"}) {
		t.Errorf("WritableTeams() = %#v, want [b]", got)
	}

	viewer := UserInstance{Role: RoleViewer, TeamIDs: []string{"a"}}
	if got := viewer.WritableTeams(); got != nil {
		t.Errorf("WritableTeams() = %#v, want nil", got)
	}
	admin := UserInstance{Role: RoleInstanceAdmin, TeamIDs: []string{"a"}}
	if got := admin.RoleIn("a"); got != "" {
		t.Errorf("an instance admin's RoleIn = %q, want none: they are not a team member", got)
	}
}
