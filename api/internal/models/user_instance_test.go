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
	in := `{"user_id":"u-1","instance_id":"i-1","team_id":"team-a","role":"developer","scope":{"tags":["x"]}}`
	if err := json.Unmarshal([]byte(in), &ui); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ui.UserID != "u-1" || ui.InstanceID != "i-1" || ui.Role != RoleDeveloper {
		t.Errorf("got %+v", ui)
	}
	if ui.Scope == nil || !reflect.DeepEqual(ui.Scope.Tags, []string{"x"}) {
		t.Errorf("scope %+v", ui.Scope)
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
