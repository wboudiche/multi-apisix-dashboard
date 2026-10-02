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
		// A record that no longer parses is still a user, known by its key: it
		// may be repaired, and a token it was issued still works.
		"/users/u-dave": []byte(`not json`),
		// One that parses and says nothing is named by its key, not by a blank.
		"/users/u-anon": []byte(`{}`),
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

		"/user_instances/u-dave/i1": []byte(`{"user_id":"u-dave","instance_id":"i1","team_ids":["t5"],"role":"viewer"}`),
		"/user_instances/u-anon/i1": []byte(`{"user_id":"u-anon","instance_id":"i1","team_ids":["t5"],"role":"viewer"}`),

		// Nobody can act through these: the user is gone, the instance is gone.
		"/user_instances/u-gone/i1": []byte(`{"user_id":"u-gone","instance_id":"i1","team_ids":["t4"],"role":"developer"}`),
		"/user_instances/u-bob/i9":  []byte(`{"user_id":"u-bob","instance_id":"i9","team_ids":["t4"],"role":"viewer"}`),
		// And one that does not parse names no team anybody can read.
		"/user_instances/u-bob/bad": []byte(`not json`),
	}

	cases := map[string][]string{
		"t1": {"alice", "alice", "bob", "carol", "erin", "root"},
		"t2": {"bob"},
		"t3": {"bob"},
		"t4": {},
		"t5": {"u-anon", "u-dave"},
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

// Where several records answer to one id, the same one names it every time -
// read in map order, the refusal named one account on one call and another on
// the next - and it is the record stored under that id, before an alias.
func TestLivingUsersNamesAnId(t *testing.T) {
	users := map[string][]byte{
		// A stale duplicate under a quoted key, beside the record itself.
		`/users/"u-bob"`: []byte(`{"id":"\"u-bob\"","username":"bob-old"}`),
		"/users/u-bob":   []byte(`{"id":"u-bob","username":"bob"}`),
		// A record kept under another key answers to its id as well, until the
		// id has a record of its own.
		"/users/legacy":  []byte(`{"id":"u-carol","username":"carol"}`),
		"/users/u-carol": []byte(`{"id":"u-carol","username":"carol-new"}`),
		"/users/old-key": []byte(`{"id":"u-frank","username":"frank"}`),
		// No username: the id being asked about, not the key of the record.
		"/users/stored-as": []byte(`{"id":"u-nameless"}`),
		// A record that does not parse does not take the name from one that does.
		`/users/"u-gina"`: []byte(`not json`),
		"/users/u-gina":   []byte(`{"id":"u-gina","username":"gina"}`),
		"/users/u-broken": []byte(`not json`),
		// No id at all is nobody.
		"/users/": []byte(`{}`),
	}
	want := map[string]string{
		"u-bob":      "bob",
		"legacy":     "carol",
		"u-carol":    "carol-new",
		"old-key":    "frank",
		"u-frank":    "frank",
		"stored-as":  "stored-as",
		"u-nameless": "u-nameless",
		"u-gina":     "gina",
		"u-broken":   "u-broken",
	}
	for i := 0; i < 20; i++ {
		if got := livingUsers(users); !reflect.DeepEqual(got, want) {
			t.Fatalf("run %d: got %v, want %v", i, got, want)
		}
	}
}
