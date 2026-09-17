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
	"encoding/json"
	"testing"
)

// A record is orphaned only on evidence: its instance is gone, its type is not
// one teams share, or a gateway that answered did not list its resource. An
// instance that could not be checked keeps its records for shared types (#248).
func TestOrphanedOwnership(t *testing.T) {
	team := []byte(`"t1"`)
	records := map[string][]byte{
		"/ownership/live/routes/r-present":  team,
		"/ownership/live/routes/r-gone":     team,
		"/ownership/live/consumers/alice":   team,
		"/ownership/live/ssls/s1":           team,
		"/ownership/live/services/unlisted": team,
		"/ownership/dead/routes/r1":         team,
		"/ownership/dead/secrets/vault":     team,
		"/ownership/removed/routes/r1":      team,
		"/ownership/live/routes":            team,
	}
	instances := map[string]bool{"live": true, "dead": true}
	present := map[string]map[string]map[string]bool{
		"live": {
			"routes":    {"r-present": true},
			"consumers": {"alice": true},
			// services was never listed: nothing is judged without a listing.
		},
	}
	unchecked := map[string]string{"dead": "routes could not be listed"}

	got := orphanedOwnership(records, instances, present, unchecked)

	want := []OrphanedOwnership{
		{Key: "/ownership/dead/secrets/vault", InstanceID: "dead", ResourceType: "secrets", ResourceID: "vault", TeamID: "t1", Reason: OwnershipTypeNotShared},
		{Key: "/ownership/live/routes/r-gone", InstanceID: "live", ResourceType: "routes", ResourceID: "r-gone", TeamID: "t1", Reason: OwnershipResourceGone},
		{Key: "/ownership/live/ssls/s1", InstanceID: "live", ResourceType: "ssls", ResourceID: "s1", TeamID: "t1", Reason: OwnershipTypeNotShared},
		{Key: "/ownership/removed/routes/r1", InstanceID: "removed", ResourceType: "routes", ResourceID: "r1", TeamID: "t1", Reason: OwnershipInstanceGone},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d orphans %+v, want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("orphan %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// A list is read into ids, consumers by username; an empty list may come back
// as {}; anything else that is not a list is an error, never an empty gateway.
func TestParseResourceIDs(t *testing.T) {
	ids, err := parseResourceIDs(json.RawMessage(`[{"value":{"id":"r1"}},{"value":{"username":"alice"}},{"value":{}}]`))
	if err != nil || len(ids) != 2 || !ids["r1"] || !ids["alice"] {
		t.Fatalf("got %v, %v, want r1 and alice", ids, err)
	}

	for _, empty := range []string{`[]`, `{}`, ` {} `} {
		ids, err := parseResourceIDs(json.RawMessage(empty))
		if err != nil || len(ids) != 0 {
			t.Errorf("%q: got %v, %v, want an empty set", empty, ids, err)
		}
	}

	for _, broken := range []string{``, `null`, `{"a":1}`, `"list"`} {
		if _, err := parseResourceIDs(json.RawMessage(broken)); err == nil {
			t.Errorf("%q: got no error, want one", broken)
		}
	}
}
