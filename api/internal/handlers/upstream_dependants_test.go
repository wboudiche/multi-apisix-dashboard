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

// What depends on an upstream decides whether draining or deleting it is safe,
// and the reader's own list cannot say: it is narrowed to their team and cut at
// 500 rows. Counted here instead, over what the gateway holds (#144, the same
// reasoning as #277).
func TestUpstreamDependants(t *testing.T) {
	routes := []byte(`{"list":[
		{"value":{"id":"r1","upstream_id":"u1"}},
		{"value":{"id":"r2","upstream_id":"u1"}},
		{"value":{"id":"r3","service_id":"s1"}},
		{"value":{"id":"r4","upstream":{"type":"roundrobin"}}}
	]}`)
	stream := []byte(`{"list":[
		{"value":{"id":"sr1","upstream_id":"u2"}}
	]}`)
	// The table the upstream filter already reads: a service points its routes
	// at an upstream, so it is a dependant of its own.
	services := serviceUpstreams{
		"s1": {ID: "u1"},
		"s2": {ID: "u2"},
		"s3": {Inline: true},
	}

	t.Run("counts routes, stream routes and services apart", func(t *testing.T) {
		reading, err := parseUpstreamDependants(routes, stream, services)
		if err != nil {
			t.Fatalf("parseUpstreamDependants: %v", err)
		}
		if !reading.StreamCounted || !reading.ServicesCounted {
			t.Errorf("readable listings were reported as uncounted: %+v", reading)
		}

		if got := reading.Counts["u1"]; got.Routes != 2 || got.Services != 1 || got.StreamRoutes != 0 {
			t.Errorf("u1 = %+v, want 2 routes, 1 service, no stream route", got)
		}
		if got := reading.Counts["u2"]; got.StreamRoutes != 1 || got.Services != 1 {
			t.Errorf("u2 = %+v, want 1 stream route and 1 service", got)
		}
	})

	// A route that carries its upstream inline depends on no upstream record,
	// and neither does a service. Counting either against one would name a
	// dependant that does not exist.
	t.Run("an inline upstream is nobody's dependant", func(t *testing.T) {
		reading, err := parseUpstreamDependants(routes, stream, services)
		if err != nil {
			t.Fatalf("parseUpstreamDependants: %v", err)
		}
		if len(reading.Counts) != 2 {
			t.Errorf("counts = %+v, want entries for u1 and u2 alone", reading.Counts)
		}
	})

	// A service table that could not be read leaves no service count behind,
	// for the same reason: nobody here knows how many there are.
	t.Run("an unread service table leaves no service count", func(t *testing.T) {
		reading, err := parseUpstreamDependants(routes, stream, nil)
		if err != nil {
			t.Fatalf("parseUpstreamDependants: %v", err)
		}
		if reading.ServicesCounted {
			t.Errorf("services were reported as counted from a table that was not read")
		}

		value := map[string]any{"id": "u1"}
		annotateUpstreamDependants(value, reading)
		if got, ok := value[dashboardServiceCountField]; ok {
			t.Errorf("__service_count = %v, want it absent", got)
		}
	})

	t.Run("a stream listing that could not be read is not a count of none", func(t *testing.T) {
		reading, err := parseUpstreamDependants(routes, nil, services)
		if err != nil {
			t.Fatalf("parseUpstreamDependants: %v", err)
		}
		if reading.StreamCounted {
			t.Errorf("stream routes were reported as counted when none were read")
		}
		if got := reading.Counts["u1"]; got.Routes != 2 {
			t.Errorf("u1 = %+v, want the routes still counted", got)
		}
	})

	// The same substitution the service counts rely on: a gateway that refuses
	// stream_routes has none, which is a count. A reading that said otherwise
	// would never be cached, so every page would pay for two listings again.
	t.Run("a collection the gateway does not serve counts as none", func(t *testing.T) {
		reading, err := parseUpstreamDependants(routes, emptyCollection, services)
		if err != nil {
			t.Fatalf("parseUpstreamDependants: %v", err)
		}
		if !reading.StreamCounted {
			t.Errorf("a gateway without stream routes was reported as uncounted")
		}
		if got := reading.Counts["u2"]; got.StreamRoutes != 0 {
			t.Errorf("u2 = %+v, want no stream route", got)
		}
	})

	t.Run("an upstream nothing depends on is annotated with zeros, not left blank", func(t *testing.T) {
		value := map[string]any{"id": "u9"}
		annotateUpstreamDependants(value, upstreamDependantsResult{
			Counts:          upstreamDependants{},
			StreamCounted:   true,
			ServicesCounted: true,
		})

		for _, field := range []string{
			dashboardRouteCountField,
			dashboardStreamRouteCountField,
			dashboardServiceCountField,
		} {
			if got, ok := value[field]; !ok || got != 0 {
				t.Errorf("%s = %v (present=%v), want 0: an absent field is how the page "+
					"says it could not count", field, got, ok)
			}
		}
	})

	t.Run("stream routes that could not be counted leave no count behind", func(t *testing.T) {
		value := map[string]any{"id": "u1"}
		annotateUpstreamDependants(value, upstreamDependantsResult{
			Counts:          upstreamDependants{"u1": {Routes: 2, Services: 1}},
			StreamCounted:   false,
			ServicesCounted: true,
		})

		if got := value[dashboardRouteCountField]; got != 2 {
			t.Errorf("__route_count = %v, want 2: that count was read and is true", got)
		}
		if got := value[dashboardServiceCountField]; got != 1 {
			t.Errorf("__service_count = %v, want 1", got)
		}
		if got, ok := value[dashboardStreamRouteCountField]; ok {
			t.Errorf("__stream_route_count = %v, want it absent", got)
		}
	})
}
