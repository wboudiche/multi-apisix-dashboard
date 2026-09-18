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

// A service list is annotated with how many routes depend on each service,
// counted over what the gateway holds rather than over what the reader may
// see: the number decides whether changing or deleting the service is safe,
// and a count narrowed to the reader's team answers "safe" about a service
// another team's routes depend on (#277).
func TestCountServiceRoutes(t *testing.T) {
	t.Run("counts routes and stream routes per service", func(t *testing.T) {
		routes := []byte(`{"list":[
			{"value":{"id":"r1","service_id":"s1"}},
			{"value":{"id":"r2","service_id":"s1"}},
			{"value":{"id":"r3","service_id":"s2"}},
			{"value":{"id":"r4","upstream_id":"u1"}}
		]}`)
		stream := []byte(`{"list":[
			{"value":{"id":"sr1","service_id":"s1"}},
			{"value":{"id":"sr2","upstream_id":"u1"}}
		]}`)

		counts, streamParsed, err := parseServiceRouteCounts(routes, stream)
		if err != nil {
			t.Fatalf("parseServiceRouteCounts: %v", err)
		}
		if !streamParsed {
			t.Errorf("the stream listing was readable and was not counted")
		}

		if got := counts["s1"]; got.Routes != 2 || got.StreamRoutes != 1 {
			t.Errorf("s1 = %+v, want 2 routes and 1 stream route", got)
		}
		if got := counts["s2"]; got.Routes != 1 || got.StreamRoutes != 0 {
			t.Errorf("s2 = %+v, want 1 route and no stream route", got)
		}
		if got, ok := counts["u1"]; ok {
			t.Errorf("an upstream id was counted as a service: %+v", got)
		}
	})

	// APISIX keeps ids in whichever JSON type they arrived as, and a service
	// created with a numeric id used to abort the decode of a whole list — the
	// bug parseServiceUpstreams already carries a comment about.
	t.Run("counts a numeric service id", func(t *testing.T) {
		routes := []byte(`{"list":[
			{"value":{"id":"r1","service_id":1700000000000000000}},
			{"value":{"id":"r2","service_id":"1700000000000000000"}}
		]}`)

		counts, _, err := parseServiceRouteCounts(routes, nil)
		if err != nil {
			t.Fatalf("parseServiceRouteCounts: %v", err)
		}
		if got := counts["1700000000000000000"]; got.Routes != 2 {
			t.Errorf("numeric and string ids were counted apart: %+v", got)
		}
	})

	// An empty collection comes back as an object, not an array - the quirk
	// src/config/req.ts works around in the browser. A gateway with no routes
	// is an answer, not a failure.
	t.Run("an empty gateway counts nothing and fails at nothing", func(t *testing.T) {
		counts, streamParsed, err := parseServiceRouteCounts([]byte(`{"list":{}}`), []byte(`{"list":{}}`))
		if err != nil {
			t.Fatalf("parseServiceRouteCounts: %v", err)
		}
		if len(counts) != 0 {
			t.Errorf("counts = %+v, want none", counts)
		}
		if !streamParsed {
			t.Errorf("an empty stream listing is a count of none, not a failure to count")
		}
	})

	t.Run("a service nothing depends on is annotated with zero, not left blank", func(t *testing.T) {
		value := map[string]any{"id": "s9"}
		annotateRouteCount(value, serviceRouteCountResult{
			Counts:        serviceRouteCounts{},
			StreamCounted: true,
		})

		if got, ok := value[dashboardRouteCountField]; !ok || got != 0 {
			t.Errorf("__route_count = %v (present=%v), want 0: a missing field is how "+
				"the page says the count could not be read", got, ok)
		}
		if got, ok := value[dashboardStreamRouteCountField]; !ok || got != 0 {
			t.Errorf("__stream_route_count = %v (present=%v), want 0", got, ok)
		}
	})

	// Two counts rather than one total: the service detail page lists them in
	// separate tabs, so a single number would not match either of them.
	t.Run("a service with dependants carries both counts", func(t *testing.T) {
		value := map[string]any{"id": "s1"}
		annotateRouteCount(value, serviceRouteCountResult{
			Counts:        serviceRouteCounts{"s1": {Routes: 2, StreamRoutes: 1}},
			StreamCounted: true,
		})

		if got := value[dashboardRouteCountField]; got != 2 {
			t.Errorf("__route_count = %v, want 2", got)
		}
		if got := value[dashboardStreamRouteCountField]; got != 1 {
			t.Errorf("__stream_route_count = %v, want 1", got)
		}
	})

	// The whole point of the flag: a gateway that could not be asked about its
	// stream routes must not have its silence read as "none", which is the
	// answer that gets a service deleted.
	t.Run("stream routes that could not be counted leave no count behind", func(t *testing.T) {
		value := map[string]any{"id": "s1"}
		annotateRouteCount(value, serviceRouteCountResult{
			Counts:        serviceRouteCounts{"s1": {Routes: 2}},
			StreamCounted: false,
		})

		if got := value[dashboardRouteCountField]; got != 2 {
			t.Errorf("__route_count = %v, want 2: the HTTP count was read and is true", got)
		}
		if got, ok := value[dashboardStreamRouteCountField]; ok {
			t.Errorf("__stream_route_count = %v, want it absent", got)
		}
	})

	// The same shape on the stream side is not a failure of the whole count:
	// the route count stands, and the stream one is simply not made.
	t.Run("an unreadable stream listing leaves the route count standing", func(t *testing.T) {
		counts, streamParsed, err := parseServiceRouteCounts(
			[]byte(`{"list":[{"value":{"id":"r1","service_id":"s1"}}]}`), []byte(`{"total":0}`))
		if err != nil {
			t.Fatalf("parseServiceRouteCounts: %v", err)
		}
		if got := counts["s1"]; got.Routes != 1 {
			t.Errorf("s1 = %+v, want the route still counted", got)
		}
		if streamParsed {
			t.Errorf("an unreadable stream listing was reported as counted")
		}
	})

	// Every APISIX collection answers with a `list`. Anything else is a shape
	// this cannot read, and zero is the reading that gets a service deleted.
	t.Run("a body with no list is a failure, not an empty gateway", func(t *testing.T) {
		if _, _, err := parseServiceRouteCounts([]byte(`{"total":0}`), nil); err == nil {
			t.Errorf("parseServiceRouteCounts accepted a body with no list")
		}
	})
}
