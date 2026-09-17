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

// The Upstream column and the upstream filter used to answer from two places:
// the filter resolved a route's service here, reading every service, while the
// column resolved it in the browser from a service list narrowed to the
// operator's team and cut at 500 rows. A developer whose route is bound to
// another team's service found it among the filter's results while its own
// cell said it had no upstream (#161). Both now read effectiveUpstream.
func TestEffectiveUpstream(t *testing.T) {
	services := serviceUpstreams{
		"svc-a":      {ID: "up-a"},
		"svc-inline": {Inline: true},
		"9002":       {ID: "777"},
	}

	cases := []struct {
		name       string
		row        map[string]any
		wantID     string
		wantInline bool
	}{
		{"its own upstream id", map[string]any{"upstream_id": "up-x"}, "up-x", false},
		{"its own id before its service", map[string]any{"upstream_id": "up-x", "service_id": "svc-a"}, "up-x", false},
		{"through its service", map[string]any{"service_id": "svc-a"}, "up-a", false},
		{"an inline upstream of its own", map[string]any{"upstream": map[string]any{"type": "roundrobin"}}, "", true},
		{"its inline upstream before its service", map[string]any{"service_id": "svc-a", "upstream": map[string]any{}}, "", true},
		{"a service carrying its upstream inline", map[string]any{"service_id": "svc-inline"}, "", true},
		{"numeric ids", map[string]any{"service_id": float64(9002)}, "777", false},
		{"a service the table does not know", map[string]any{"service_id": "svc-gone"}, "", false},
		{"nothing to reach", map[string]any{"uri": "/x"}, "", false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, inline := effectiveUpstream(c.row, services)
			if id != c.wantID || inline != c.wantInline {
				t.Errorf("effectiveUpstream(%v) = (%q, %v), want (%q, %v)",
					c.row, id, inline, c.wantID, c.wantInline)
			}
		})
	}
}

// A route bound to a service that carries its upstream inline still reaches a
// backend, so the table has to remember that service rather than leave it out.
func TestServiceUpstreamsRecordsInlineServices(t *testing.T) {
	got, err := parseServiceUpstreams([]byte(`{"list":[
		{"value":{"id":"svc-named","upstream_id":"up-a"}},
		{"value":{"id":"svc-inline","upstream":{"type":"roundrobin"}}},
		{"value":{"id":"svc-bare"}}
	]}`))
	if err != nil {
		t.Fatalf("parseServiceUpstreams: %v", err)
	}

	if got["svc-named"] != (serviceUpstream{ID: "up-a"}) {
		t.Errorf("svc-named = %+v, want its upstream id", got["svc-named"])
	}
	if got["svc-inline"] != (serviceUpstream{Inline: true}) {
		t.Errorf("svc-inline = %+v, want an inline upstream", got["svc-inline"])
	}
	if entry, ok := got["svc-bare"]; ok {
		t.Errorf("svc-bare = %+v, want no entry: it reaches no upstream", entry)
	}
}

// Each route row carries what its Upstream cell shows, resolved by the rules
// the upstream filter applies, so the two cannot disagree.
func TestAnnotateUpstream(t *testing.T) {
	services := serviceUpstreams{"svc-a": {ID: "up-a"}, "svc-inline": {Inline: true}}

	cases := []struct {
		name       string
		row        map[string]any
		wantID     any
		wantInline any
	}{
		{"an upstream reached through a service", map[string]any{"service_id": "svc-a"}, "up-a", nil},
		{"an inline upstream reached through a service", map[string]any{"service_id": "svc-inline"}, nil, true},
		{"no upstream at all", map[string]any{"uri": "/x"}, nil, nil},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			annotateUpstream(c.row, services)
			if got := c.row[dashboardUpstreamIDField]; got != c.wantID {
				t.Errorf("%s = %v, want %v", dashboardUpstreamIDField, got, c.wantID)
			}
			if got := c.row[dashboardUpstreamInlineField]; got != c.wantInline {
				t.Errorf("%s = %v, want %v", dashboardUpstreamInlineField, got, c.wantInline)
			}
		})
	}
}
