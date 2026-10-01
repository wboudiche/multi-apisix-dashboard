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
	"errors"
	"reflect"
	"testing"
)

// A team is not deleted from under the people assigned to it (#375). Who that
// is, is not every assignment that names it: an operator can only move the
// ones a screen shows. The others stop naming the team as part of the delete,
// so that none goes on naming it once it is gone.
func TestTeamAssignments(t *testing.T) {
	users := map[string][]byte{
		"/users/u-alice": []byte(`{"id":"u-alice","username":"alice","role":""}`),
		"/users/u-bob":   []byte(`{"id":"u-bob","username":"bob","role":""}`),
		"/users/u-root":  []byte(`{"id":"u-root","username":"root","role":"super_admin"}`),
		"/users/u-carol": []byte(`{"id":"u-carol","username":"carol","role":""}`),
		// A record that no longer parses is still a user, known by its key.
		"/users/u-dave": []byte(`not json`),
		// Two accounts under one name are two people to go and find.
		"/users/u-twin": []byte(`{"id":"u-twin","username":"alice","role":""}`),
	}
	instances := map[string][]byte{"/instances/i1": []byte(`{}`), "/instances/i2": []byte(`{}`)}
	assignments := map[string][]byte{
		// One of several teams, and the team of an older record.
		"/user_instances/u-bob/i1":   []byte(`{"user_id":"u-bob","instance_id":"i1","team_ids":["t2","t1"],"role":"developer"}`),
		"/user_instances/u-alice/i1": []byte(`{"user_id":"u-alice","instance_id":"i1","team_id":"t1","role":"viewer"}`),
		// On two instances: one person to go and find, not two.
		"/user_instances/u-alice/i2": []byte(`{"user_id":"u-alice","instance_id":"i2","team_ids":["t1"],"role":"developer"}`),
		// An instance admin's names the team all the same, and the page shows it.
		"/user_instances/u-carol/i1": []byte(`{"user_id":"u-carol","instance_id":"i1","team_ids":["t1"],"role":"instance_admin"}`),
		"/user_instances/u-dave/i1":  []byte(`{"user_id":"u-dave","instance_id":"i1","team_ids":["t1"],"role":"viewer"}`),
		"/user_instances/u-twin/i1":  []byte(`{"user_id":"u-twin","instance_id":"i1","team_ids":["t1"],"role":"viewer"}`),

		// Never read while the role is global - and read again the day it is
		// taken away, which is why it must not go on naming the team.
		"/user_instances/u-root/i1": []byte(`{"user_id":"u-root","instance_id":"i1","team_ids":["t1"],"role":"developer"}`),
		// Nobody's: the user is gone.
		"/user_instances/u-gone/i1": []byte(`{"user_id":"u-gone","instance_id":"i1","team_ids":["t1"],"role":"developer"}`),
		// The instance is gone: the Users page has no card to edit it on.
		"/user_instances/u-bob/i9": []byte(`{"user_id":"u-bob","instance_id":"i9","team_ids":["t1"],"role":"viewer"}`),
		// Written under a quoted id by an old bug: the page does not read it.
		`/user_instances/"u-bob"/i2`: []byte(`{"user_id":"\"u-bob\"","instance_id":"i2","team_ids":["t3"],"role":"viewer"}`),
		// Does not name the team, and one that does not parse: neither is touched.
		"/user_instances/u-carol/i2": []byte(`{"user_id":"u-carol","instance_id":"i2","team_ids":["t2"],"role":"viewer"}`),
		"/user_instances/u-bob/bad":  []byte(`not json`),
	}

	cases := map[string]struct {
		holders  []string
		released []string
	}{
		"t1": {
			holders:  []string{"alice", "alice", "bob", "carol", "u-dave"},
			released: []string{"/user_instances/u-bob/i9", "/user_instances/u-gone/i1", "/user_instances/u-root/i1"},
		},
		"t2": {holders: []string{"bob", "carol"}, released: []string{}},
		// Only under the quoted key: nobody to move, and taken out of it.
		"t3": {holders: []string{}, released: []string{`/user_instances/"u-bob"/i2`}},
		"t9": {holders: []string{}, released: []string{}},
	}
	for team, want := range cases {
		holders, released, err := teamAssignments(assignments, users, instances, team)
		if err != nil {
			t.Fatalf("team %q: %v", team, err)
		}
		if !reflect.DeepEqual(holders, want.holders) {
			t.Errorf("team %q: holders %v, want %v", team, holders, want.holders)
		}
		if !reflect.DeepEqual(released, want.released) {
			t.Errorf("team %q: released %v, want %v", team, released, want.released)
		}
	}
}

// With no users read at all, nothing is judged: that read failed, and against
// it every assignment would be nobody's - and the team deleted from under all
// of them.
func TestTeamAssignmentsRefusesWithNoUsers(t *testing.T) {
	assignments := map[string][]byte{
		"/user_instances/u-alice/i1": []byte(`{"user_id":"u-alice","instance_id":"i1","team_ids":["t1"],"role":"viewer"}`),
	}
	_, _, err := teamAssignments(assignments, map[string][]byte{}, map[string][]byte{"/instances/i1": nil}, "t1")
	if !errors.Is(err, ErrNoUsersRead) {
		t.Fatalf("got %v, want ErrNoUsersRead", err)
	}
}

func TestWithoutTeam(t *testing.T) {
	if got := withoutTeam([]string{"t1", "t2", "t1"}, "t1"); !reflect.DeepEqual(got, []string{"t2"}) {
		t.Errorf("got %v", got)
	}
	// A list, not nil: the record is written back as [].
	if got := withoutTeam([]string{"t1"}, "t1"); got == nil || len(got) != 0 {
		t.Errorf("got %#v, want an empty list", got)
	}
}
