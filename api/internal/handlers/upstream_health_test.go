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

import "testing"

// APISIX reports what its health checkers have seen through the Control API.
// It lists only the resources that have `checks` configured, so an upstream
// missing from the answer has no health check - which is a different thing
// from an upstream that is failing one, and a different thing again from a
// gateway that could not be asked at all (#281).
func TestUpstreamHealth(t *testing.T) {
	// The shape the gateway sends: the etcd key, the checker type, and the
	// targets with the states resty.healthcheck keeps for them.
	const body = `[
		{"name":"/apisix/upstreams/up-1","type":"http","nodes":[
			{"ip":"127.0.0.1","port":1980,"status":"healthy"},
			{"ip":"127.0.0.1","port":1981,"status":"unhealthy"}
		]},
		{"name":"/apisix/upstreams/up-2","type":"tcp","nodes":{}},
		{"name":"/apisix/routes/route-1","type":"http","nodes":[
			{"ip":"127.0.0.1","port":1982,"status":"healthy"}
		]}
	]`

	t.Run("reads the nodes of each upstream that is checked", func(t *testing.T) {
		health, err := parseUpstreamHealth([]byte(body))
		if err != nil {
			t.Fatalf("parseUpstreamHealth: %v", err)
		}

		up1, ok := health["up-1"]
		if !ok {
			t.Fatalf("up-1 missing from %+v", health)
		}
		if len(up1.Nodes) != 2 {
			t.Fatalf("up-1 nodes = %+v, want two", up1.Nodes)
		}
		if up1.Nodes[0].Host != "127.0.0.1" || up1.Nodes[0].Port != 1980 ||
			up1.Nodes[0].Status != "healthy" {
			t.Errorf("up-1 first node = %+v, want 127.0.0.1:1980 healthy", up1.Nodes[0])
		}
		if up1.Nodes[1].Status != "unhealthy" {
			t.Errorf("up-1 second node = %+v, want unhealthy", up1.Nodes[1])
		}
	})

	// A checker that exists but has measured nothing yet - APISIX creates it
	// when the upstream is first used - is checked with nothing to say, not
	// unhealthy. Its target list is a Lua table as well, so an empty one
	// arrives as `{}` rather than `[]`: the same quirk as the whole body, one
	// level down, and the one that made the column read "not known" in CI
	// after the first was fixed.
	t.Run("keeps an upstream whose checker has measured nothing", func(t *testing.T) {
		health, err := parseUpstreamHealth([]byte(body))
		if err != nil {
			t.Fatalf("parseUpstreamHealth: %v", err)
		}
		up2, ok := health["up-2"]
		if !ok {
			t.Fatalf("up-2 missing from %+v", health)
		}
		if len(up2.Nodes) != 0 {
			t.Errorf("up-2 nodes = %+v, want none", up2.Nodes)
		}
	})

	// A route can carry its own upstream and its own checks. Counting that
	// against an upstream record would name health for something else.
	t.Run("ignores the health of anything that is not an upstream", func(t *testing.T) {
		health, err := parseUpstreamHealth([]byte(body))
		if err != nil {
			t.Fatalf("parseUpstreamHealth: %v", err)
		}
		if _, ok := health["route-1"]; ok {
			t.Errorf("a route's health was filed under an upstream id: %+v", health)
		}
		if len(health) != 2 {
			t.Errorf("health = %+v, want up-1 and up-2 alone", health)
		}
	})

	// The etcd prefix is a deployment setting - this repo's own second gateway
	// runs on /apisix2 - and the control API names each resource by its key. A
	// prefix taken for a constant would drop every upstream on such a gateway
	// and call them all unwatched.
	t.Run("finds an upstream whatever the gateway's etcd prefix is", func(t *testing.T) {
		health, err := parseUpstreamHealth([]byte(
			`[{"name":"/apisix2/upstreams/up-9","nodes":[{"ip":"h","port":1,"status":"healthy"}]}]`))
		if err != nil {
			t.Fatalf("parseUpstreamHealth: %v", err)
		}
		if _, ok := health["up-9"]; !ok {
			t.Errorf("health = %+v, want up-9 found under another prefix", health)
		}
	})

	// An APISIX with no health checkers at all answers with an empty array.
	t.Run("an answer with nothing in it is an answer", func(t *testing.T) {
		health, err := parseUpstreamHealth([]byte(`[]`))
		if err != nil {
			t.Fatalf("parseUpstreamHealth: %v", err)
		}
		if len(health) != 0 {
			t.Errorf("health = %+v, want none", health)
		}
	})

	// The shape a gateway with no checker running actually sends: the report
	// is a Lua table, and an empty one serialises as an object. Read as a
	// failure, it made every upstream say its health could not be known - what
	// CI showed the first time this ran against a real APISIX.
	t.Run("an empty report is none, not unreadable", func(t *testing.T) {
		health, err := parseUpstreamHealth([]byte(`{}`))
		if err != nil {
			t.Fatalf("parseUpstreamHealth: %v", err)
		}
		if len(health) != 0 {
			t.Errorf("health = %+v, want none", health)
		}
	})

	t.Run("a body that is not the expected shape is a failure", func(t *testing.T) {
		if _, err := parseUpstreamHealth([]byte(`{"error_msg":"no"}`)); err == nil {
			t.Errorf("parseUpstreamHealth accepted an object where a list was due")
		}
	})

	// The annotation says which of the three answers this is, because they
	// have opposite consequences: a red badge for a gateway nobody could ask
	// is the same lie as a green one.
	t.Run("says whether an upstream is checked at all", func(t *testing.T) {
		health := upstreamHealth{"up-1": {Nodes: []healthNode{{Host: "h", Port: 1, Status: "healthy"}}}}

		checked := map[string]any{"id": "up-1"}
		annotateUpstreamHealth(checked, health)
		entry, ok := checked[dashboardHealthField].(map[string]any)
		if !ok {
			t.Fatalf("__health = %v, want an object", checked[dashboardHealthField])
		}
		if entry["checked"] != true {
			t.Errorf("__health.checked = %v, want true", entry["checked"])
		}

		// Configured but not reported on: the report says what is running, and
		// a checker is built when the upstream is first used. Reading that
		// silence as "nothing watches this" is the firm claim in the dangerous
		// direction - and it is what a reading taken seconds before the
		// upstream was written would say.
		fresh := map[string]any{"id": "up-fresh", "checks": map[string]any{"active": map[string]any{}}}
		annotateUpstreamHealth(fresh, health)
		entry, ok = fresh[dashboardHealthField].(map[string]any)
		if !ok {
			t.Fatalf("__health = %v, want an object", fresh[dashboardHealthField])
		}
		if entry["checked"] != true {
			t.Errorf("__health.checked = %v for an upstream that declares a check, want true",
				entry["checked"])
		}

		unchecked := map[string]any{"id": "up-9"}
		annotateUpstreamHealth(unchecked, health)
		entry, ok = unchecked[dashboardHealthField].(map[string]any)
		if !ok {
			t.Fatalf("__health = %v, want an object", unchecked[dashboardHealthField])
		}
		if entry["checked"] != false {
			t.Errorf("__health.checked = %v, want false: no checker is not a failing one",
				entry["checked"])
		}
		if _, hasNodes := entry["nodes"]; hasNodes {
			t.Errorf("__health carried nodes for an upstream with no checker: %v", entry)
		}
	})
}
