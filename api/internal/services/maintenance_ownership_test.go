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
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// A record is orphaned only on evidence: its instance is gone, its type is not
// one teams share, or a gateway that answered did not list its resource. An
// instance that was not asked keeps its records for shared types (#248).
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

	got := orphanedOwnership(records, instances, present, map[string]bool{"dead": true})

	want := []OrphanedOwnership{
		{Key: "/ownership/dead/secrets/vault", InstanceID: "dead", ResourceType: "secrets", ResourceID: "vault", TeamID: "t1", Reason: OwnershipTypeNotShared},
		{Key: "/ownership/live/routes/r-gone", InstanceID: "live", ResourceType: "routes", ResourceID: "r-gone", TeamID: "t1", Reason: OwnershipResourceGone},
		{Key: "/ownership/live/ssls/s1", InstanceID: "live", ResourceType: "ssls", ResourceID: "s1", TeamID: "t1", Reason: OwnershipTypeNotShared},
		{Key: "/ownership/removed/routes/r1", InstanceID: "removed", ResourceType: "routes", ResourceID: "r1", TeamID: "t1", Reason: OwnershipInstanceGone},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

// A list is read into ids: a row's key first, then its value's id, string or
// number, then a consumer's username. An empty list may come back as {};
// anything else that is not a list is an error, never an empty gateway.
func TestParseResourceIDs(t *testing.T) {
	ids, err := parseResourceIDs(json.RawMessage(`[
		{"key":"/apisix/routes/r1","value":{"id":"r1"}},
		{"key":"/apisix/routes/123","value":{"id":123}},
		{"value":{"id":456}},
		{"value":{"id":"r2"}},
		{"key":"/apisix/consumers/alice","value":{"username":"alice"}},
		{"value":{"username":"bob"}},
		{"value":{}}
	]`))
	want := map[string]bool{"r1": true, "123": true, "456": true, "r2": true, "alice": true, "bob": true}
	if err != nil || !reflect.DeepEqual(ids, want) {
		t.Fatalf("got %v, %v, want %v", ids, err, want)
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

type fakeLister struct {
	ids   map[string]map[string]map[string]bool
	fails map[string]bool // "<instance>/<type>"
	calls []string
}

func (f *fakeLister) ListResourceIDs(_ context.Context, instance *models.Instance, resourceType string) (map[string]bool, error) {
	call := instance.ID + "/" + resourceType
	f.calls = append(f.calls, call)
	if f.fails[call] {
		return nil, errors.New("answered 400")
	}
	return f.ids[instance.ID][resourceType], nil
}

func instanceRecord(id string, active bool) []byte {
	value, _ := json.Marshal(models.Instance{ID: id, AdminAPIURL: "http://" + id, IsActive: active})
	return value
}

// Gateways are asked only for the types their records name and the scope
// allows. An instance that is inactive or unreadable is not asked, and keeps
// its records for shared types; a type its gateway fails to list keeps its
// records while the instance's other types are still judged (#248).
func TestJudgeOwnership(t *testing.T) {
	team := []byte(`"t1"`)
	records := map[string][]byte{
		"/ownership/live/routes/present":    team,
		"/ownership/live/routes/gone":       team,
		"/ownership/live/stream_routes/sr1": team,
		"/ownership/live/services/outside":  team,
		"/ownership/off/routes/x":           team,
		"/ownership/garbled/routes/y":       team,
		"/ownership/garbled/ssls/z":         team,
	}
	instances := map[string][]byte{
		"/instances/live":    instanceRecord("live", true),
		"/instances/off":     instanceRecord("off", false),
		"/instances/garbled": []byte(`not json`),
	}
	lister := &fakeLister{
		ids:   map[string]map[string]map[string]bool{"live": {"routes": {"present": true}}},
		fails: map[string]bool{"live/stream_routes": true},
	}
	notServices := func(_, resourceType string) bool { return resourceType != "services" }

	report := judgeOwnership(context.Background(), records, instances, lister, notServices)

	keys := []string{}
	for _, o := range report.Orphans {
		keys = append(keys, o.Key+" "+o.Reason)
	}
	wantKeys := []string{
		"/ownership/garbled/ssls/z " + OwnershipTypeNotShared,
		"/ownership/live/routes/gone " + OwnershipResourceGone,
	}
	if !reflect.DeepEqual(keys, wantKeys) {
		t.Errorf("orphans %v, want %v", keys, wantKeys)
	}

	unchecked := []string{}
	for _, u := range report.Unchecked {
		unchecked = append(unchecked, u.InstanceID+"/"+u.ResourceType)
	}
	sort.Strings(unchecked)
	if want := []string{"garbled/", "live/stream_routes", "off/"}; !reflect.DeepEqual(unchecked, want) {
		t.Errorf("unchecked %v, want %v", unchecked, want)
	}
	if !report.unchecked("live", "stream_routes") || report.unchecked("live", "routes") || !report.unchecked("off", "routes") {
		t.Errorf("unchecked() disagrees with the report %+v", report.Unchecked)
	}

	// Not asked about services, which the scope leaves out, nor about the
	// instances it could not ask.
	if want := []string{"live/routes", "live/stream_routes"}; !reflect.DeepEqual(lister.calls, want) {
		t.Errorf("gateway calls %v, want %v", lister.calls, want)
	}
}
