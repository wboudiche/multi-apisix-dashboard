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
	"sort"
	"testing"
)

// A team's members are the assignments that hold it, whether as their one
// team - every record written before #301 - or as one of several.
func TestAssignmentsOfTeam(t *testing.T) {
	records := map[string][]byte{
		"/user_instances/old/i1":       []byte(`{"user_id":"old","instance_id":"i1","team_id":"t1","role":"developer"}`),
		"/user_instances/both/i1":      []byte(`{"user_id":"both","instance_id":"i1","team_ids":["t2","t1"],"role":"developer"}`),
		"/user_instances/other/i1":     []byte(`{"user_id":"other","instance_id":"i1","team_ids":["t2"],"role":"viewer"}`),
		"/user_instances/admin/i1":     []byte(`{"user_id":"admin","instance_id":"i1","team_id":"","role":"instance_admin"}`),
		"/user_instances/unread/i1":    []byte(`not json`),
		"/user_instances/elsewhere/i2": []byte(`{"user_id":"elsewhere","instance_id":"i2","team_ids":["t1"],"role":"viewer"}`),
	}

	members := func(team string) []string {
		var ids []string
		for _, ui := range assignmentsOfTeam(records, team) {
			ids = append(ids, ui.UserID+"@"+ui.InstanceID)
		}
		sort.Strings(ids)
		return ids
	}

	cases := map[string][]string{
		"t1": {"both@i1", "elsewhere@i2", "old@i1"},
		"t2": {"both@i1", "other@i1"},
		"t3": nil,
		// No team is not a team: an admin with none is not a member of "".
		"": nil,
	}
	for team, want := range cases {
		got := members(team)
		if len(got) != len(want) {
			t.Errorf("team %q: got %v, want %v", team, got, want)
			continue
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("team %q: got %v, want %v", team, got, want)
				break
			}
		}
	}
}
