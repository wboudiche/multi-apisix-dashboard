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

// A team is not deleted from under the accounts assigned to it (#375): every
// user that exists, on an instance that exists - which is what the access
// layer could honour, today or the day a role changes.
func TestTeamHolders(t *testing.T) {
	users := map[string][]byte{
		"/users/u-alice": []byte(`{"id":"u-alice","username":"alice","role":""}`),
		"/users/u-bob":   []byte(`{"id":"u-bob","username":"bob","role":""}`),
		"/users/u-root":  []byte(`{"id":"u-root","username":"root","role":"super_admin"}`),
		"/users/u-carol": []byte(`{"id":"u-carol","username":"carol","role":""}`),
		// Two accounts under one name are two people to go and find.
		"/users/u-twin": []byte(`{"id":"u-twin","username":"alice","role":""}`),
		// An id an old bug wrote in quotes, in the record: the same user.
		"/users/u-erin": []byte(`{"id":"\"u-erin\"","username":"erin","role":""}`),
		// A record that does not parse cannot sign in, and no screen lists it.
		"/users/u-dave": []byte(`not json`),
	}
	instances := map[string][]byte{"/instances/i1": []byte(`{}`), "/instances/i2": []byte(`{}`)}
	assignments := map[string][]byte{
		// One of several teams, and the team of an older record.
		"/user_instances/u-bob/i1":   []byte(`{"user_id":"u-bob","instance_id":"i1","team_ids":["t2","t1"],"role":"developer"}`),
		"/user_instances/u-alice/i1": []byte(`{"user_id":"u-alice","instance_id":"i1","team_id":"t1","role":"viewer"}`),
		// On two instances: one person to go and find, not two.
		"/user_instances/u-alice/i2": []byte(`{"user_id":"u-alice","instance_id":"i2","team_ids":["t1"],"role":"developer"}`),
		"/user_instances/u-carol/i1": []byte(`{"user_id":"u-carol","instance_id":"i1","team_ids":["t1"],"role":"instance_admin"}`),
		"/user_instances/u-twin/i1":  []byte(`{"user_id":"u-twin","instance_id":"i1","team_ids":["t1"],"role":"viewer"}`),
		"/user_instances/u-erin/i1":  []byte(`{"user_id":"u-erin","instance_id":"i1","team_ids":["t1"],"role":"viewer"}`),
		// Not read while the role is global, and read again the day it is not.
		"/user_instances/u-root/i1": []byte(`{"user_id":"u-root","instance_id":"i1","team_ids":["t1"],"role":"developer"}`),
		// Under a quoted key, which RBAC still reads as bob's.
		`/user_instances/"u-bob"/i2`: []byte(`{"user_id":"\"u-bob\"","instance_id":"i2","team_ids":["t3"],"role":"viewer"}`),

		// Nobody can act through these: the user is gone, the instance is
		// gone, the user's record cannot be read.
		"/user_instances/u-gone/i1": []byte(`{"user_id":"u-gone","instance_id":"i1","team_ids":["t4"],"role":"developer"}`),
		"/user_instances/u-bob/i9":  []byte(`{"user_id":"u-bob","instance_id":"i9","team_ids":["t4"],"role":"viewer"}`),
		"/user_instances/u-dave/i1": []byte(`{"user_id":"u-dave","instance_id":"i1","team_ids":["t4"],"role":"viewer"}`),
		// And one that does not parse names no team anybody can read.
		"/user_instances/u-bob/bad": []byte(`not json`),
	}

	cases := map[string][]string{
		"t1": {"alice", "alice", "bob", "carol", "erin", "root"},
		"t2": {"bob"},
		"t3": {"bob"},
		"t4": {},
		"t9": {},
	}
	for team, want := range cases {
		got, err := teamHolders(assignments, users, instances, team)
		if err != nil {
			t.Fatalf("team %q: %v", team, err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("team %q: holders %v, want %v", team, got, want)
		}
	}
}

// With no users read at all, nothing is judged: that read failed, and against
// it every assignment would be nobody's - and the team deleted from under all
// of them.
func TestTeamHoldersRefusesWithNoUsers(t *testing.T) {
	assignments := map[string][]byte{
		"/user_instances/u-alice/i1": []byte(`{"user_id":"u-alice","instance_id":"i1","team_ids":["t1"],"role":"viewer"}`),
	}
	_, err := teamHolders(assignments, map[string][]byte{}, map[string][]byte{"/instances/i1": nil}, "t1")
	if !errors.Is(err, ErrNoUsersRead) {
		t.Fatalf("got %v, want ErrNoUsersRead", err)
	}
}
