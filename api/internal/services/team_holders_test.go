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
	"reflect"
	"testing"
)

// A team is not deleted from under the people assigned to it (#375). Who that
// is, is not every assignment that names it: the Users page shows neither a
// deleted user nor a super admin's assignments, and a refusal over one of
// those told the operator to move somebody no screen could show them.
func TestTeamHolders(t *testing.T) {
	users := map[string][]byte{
		"/users/u-alice": []byte(`{"id":"u-alice","username":"alice","role":""}`),
		"/users/u-bob":   []byte(`{"id":"u-bob","username":"bob","role":""}`),
		"/users/u-root":  []byte(`{"id":"u-root","username":"root","role":"super_admin"}`),
		"/users/u-carol": []byte(`{"id":"u-carol","username":"carol","role":""}`),
	}
	assignments := map[string][]byte{
		// One of several teams, and the team of an older record.
		"/user_instances/u-bob/i1":   []byte(`{"user_id":"u-bob","instance_id":"i1","team_ids":["t2","t1"],"role":"developer"}`),
		"/user_instances/u-alice/i1": []byte(`{"user_id":"u-alice","instance_id":"i1","team_id":"t1","role":"viewer"}`),
		// On two instances: one person to go and find, not two.
		"/user_instances/u-alice/i2": []byte(`{"user_id":"u-alice","instance_id":"i2","team_ids":["t1"],"role":"developer"}`),
		// An instance admin holds it too: the record names the team all the same.
		"/user_instances/u-carol/i1": []byte(`{"user_id":"u-carol","instance_id":"i1","team_ids":["t1"],"role":"instance_admin"}`),
		// Never read: the role is global.
		"/user_instances/u-root/i1": []byte(`{"user_id":"u-root","instance_id":"i1","team_ids":["t1"],"role":"developer"}`),
		// Nobody's: the user is gone, and the maintenance page purges it.
		"/user_instances/u-gone/i1": []byte(`{"user_id":"u-gone","instance_id":"i1","team_ids":["t1"],"role":"developer"}`),
		// An id written in quotes by an old bug is still the same user.
		`/user_instances/"u-bob"/i2`: []byte(`{"user_id":"\"u-bob\"","instance_id":"i2","team_ids":["t3"],"role":"viewer"}`),
	}

	cases := map[string][]string{
		"t1": {"alice", "bob", "carol"},
		"t2": {"bob"},
		"t3": {"bob"},
		"t9": {},
	}
	for team, want := range cases {
		if got := teamHolders(assignments, users, team); !reflect.DeepEqual(got, want) {
			t.Errorf("team %q: holders %v, want %v", team, got, want)
		}
	}
}
