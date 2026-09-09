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

import (
	"net/url"
	"testing"
)

func row(value map[string]any) map[string]any {
	return map[string]any{"value": value}
}

func TestParseListFilters(t *testing.T) {
	t.Run("reads every supported filter", func(t *testing.T) {
		f := parseListFilters(url.Values{
			"name":   {"Billing"},
			"uri":    {"/services"},
			"label":  {"Env:Prod"},
			"status": {"0"},
		})
		if f.name != "Billing" || f.uri != "/services" ||
			len(f.labels) != 1 || f.labels[0] != "Env:Prod" {
			t.Errorf("parseListFilters gave %+v", f)
		}
		if f.status == nil || *f.status != 0 {
			t.Errorf("status = %v, want 0", f.status)
		}
	})

	t.Run("no filters means nothing to do", func(t *testing.T) {
		if !parseListFilters(url.Values{"page": {"1"}}).empty() {
			t.Error("expected empty() for a query with no filters")
		}
	})

	t.Run("a filter present but blank is not a filter", func(t *testing.T) {
		if !parseListFilters(url.Values{"name": {""}, "status": {""}}).empty() {
			t.Error("expected empty() when the filter values are blank")
		}
	})

	t.Run("an unparseable status is ignored rather than matching nothing", func(t *testing.T) {
		f := parseListFilters(url.Values{"status": {"maybe"}})
		if f.status != nil {
			t.Errorf("status = %v, want nil for an unparseable value", f.status)
		}
	})
}

func TestMatchesListFilters(t *testing.T) {
	billing := map[string]any{"name": "BillingService.GetInvoice", "uri": "/services/Billing"}
	multi := map[string]any{"name": "Multi", "uris": []any{"/a", "/Bravo"}}

	tests := []struct {
		name  string
		value map[string]any
		query url.Values
		want  bool
	}{
		// The reported bug: APISIX matches case-sensitively, so a lowercase
		// search hid a route that plainly exists.
		{"name matches ignoring case", billing, url.Values{"name": {"billingservice"}}, true},
		{"name matches as a substring", billing, url.Values{"name": {"Service"}}, true},
		{"name substring ignoring case", billing, url.Values{"name": {"getinvoice"}}, true},
		{"name that does not occur", billing, url.Values{"name": {"zzz"}}, false},

		{"uri matches ignoring case", billing, url.Values{"uri": {"/services/billing"}}, true},
		{"uri matches as a substring", billing, url.Values{"uri": {"services"}}, true},
		{"uri that does not occur", billing, url.Values{"uri": {"/nope"}}, false},
		// A route can answer on several paths; any of them counts.
		{"uri matches one of uris", multi, url.Values{"uri": {"bravo"}}, true},
		{"uri matches no entry in uris", multi, url.Values{"uri": {"charlie"}}, false},

		// Every filter given has to match, not just one.
		{"all filters must match", billing, url.Values{"name": {"billing"}, "uri": {"/nope"}}, false},
		{"no filters matches everything", billing, url.Values{}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := matchesListFilters(tt.value, parseListFilters(tt.query))
			if got != tt.want {
				t.Errorf("matchesListFilters(%v) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

// APISIX stores no status field at all for a route created without one, and
// treats that as enabled. Matching only an explicit 1 would hide those routes
// from the Published filter — the same silent omission this fix exists to end.
func TestStatusFilterTreatsAbsentAsPublished(t *testing.T) {
	absent := map[string]any{"name": "no-status"}
	published := map[string]any{"name": "on", "status": float64(1)}
	unpublished := map[string]any{"name": "off", "status": float64(0)}

	tests := []struct {
		name   string
		value  map[string]any
		status string
		want   bool
	}{
		{"absent counts as published", absent, "1", true},
		{"absent is not unpublished", absent, "0", false},
		{"explicit 1 is published", published, "1", true},
		{"explicit 1 is not unpublished", published, "0", false},
		{"explicit 0 is unpublished", unpublished, "0", true},
		{"explicit 0 is not published", unpublished, "1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := parseListFilters(url.Values{"status": {tt.status}})
			if got := matchesListFilters(tt.value, f); got != tt.want {
				t.Errorf("status=%s against %v = %v, want %v", tt.status, tt.value, got, tt.want)
			}
		})
	}
}

// APISIX matches a label on its key alone, ignoring any value after the colon.
// That is preserved here, so switching to dashboard-side filtering does not
// quietly change which routes a saved filter returns.
func TestLabelFilterMatchesOnKey(t *testing.T) {
	labelled := map[string]any{
		"name":   "labelled",
		"labels": map[string]any{"Env": "Prod"},
	}

	cases := []struct {
		label string
		want  bool
	}{
		{"Env", true},          // a bare key still matches on the key alone
		{"env", true},          // case-insensitive, unlike APISIX
		{"Env:Prod", true},     // key and value both match
		{"env:prod", true},     // ...still ignoring case
		{"Env:Staging", false}, // the value is significant now, see below
		{"Region", false},
	}

	for _, c := range cases {
		t.Run(c.label, func(t *testing.T) {
			f := parseListFilters(url.Values{"label": {c.label}})
			if got := matchesListFilters(labelled, f); got != c.want {
				t.Errorf("label=%q = %v, want %v", c.label, got, c.want)
			}
		})
	}

	t.Run("a route with no labels never matches", func(t *testing.T) {
		f := parseListFilters(url.Values{"label": {"Env"}})
		if matchesListFilters(map[string]any{"name": "bare"}, f) {
			t.Error("expected no match for a route without labels")
		}
	})
}

func TestPaginateRows(t *testing.T) {
	rows := make([]map[string]any, 0, 25)
	for i := 0; i < 25; i++ {
		rows = append(rows, row(map[string]any{"id": i}))
	}

	tests := []struct {
		name      string
		page      int
		pageSize  int
		wantCount int
		wantFirst int
	}{
		{"first page", 1, 10, 10, 0},
		{"middle page", 2, 10, 10, 10},
		{"last partial page", 3, 10, 5, 20},
		{"past the end yields nothing", 4, 10, 0, -1},
		// A missing or nonsensical page falls back to showing everything rather
		// than an empty table.
		{"page zero", 0, 10, 25, 0},
		{"no page size", 1, 0, 25, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := paginateRows(rows, tt.page, tt.pageSize)
			if len(got) != tt.wantCount {
				t.Fatalf("paginateRows(page=%d, size=%d) returned %d rows, want %d",
					tt.page, tt.pageSize, len(got), tt.wantCount)
			}
			if tt.wantFirst >= 0 && len(got) > 0 {
				first := got[0]["value"].(map[string]any)["id"].(int)
				if first != tt.wantFirst {
					t.Errorf("first row id = %d, want %d", first, tt.wantFirst)
				}
			}
		})
	}
}

// The owning team is not part of the resource APISIX stores; the proxy injects
// it into each row just before filtering. These pin that the filter reads it
// from there, and that "belongs to no team" is expressible — an admin needs to
// find unassigned resources, since nobody else can see them at all.
func TestMatchesTeam(t *testing.T) {
	row := func(team any) map[string]any {
		if team == nil {
			return map[string]any{"name": "r"}
		}
		return map[string]any{"name": "r", dashboardTeamIDField: team}
	}

	tests := []struct {
		name  string
		value map[string]any
		want  string
		match bool
	}{
		{"same team matches", row("backend"), "backend", true},
		{"another team does not", row("frontend"), "backend", false},
		{"unassigned does not match a named team", row(""), "backend", false},
		{"a missing field does not match a named team", row(nil), "backend", false},
		{"the reserved token finds unassigned rows", row(""), unassignedTeamFilter, true},
		{"the reserved token finds rows with no field at all", row(nil), unassignedTeamFilter, true},
		{"the reserved token skips owned rows", row("backend"), unassignedTeamFilter, false},
		// The field is injected as a string; anything else is not an owner.
		{"a non-string owner matches nothing", row(42), "backend", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := matchesTeam(tt.value, []string{tt.want}); got != tt.match {
				t.Errorf("matchesTeam(%v, %q) = %v, want %v", tt.value, tt.want, got, tt.match)
			}
		})
	}
}

// A team filter has to survive the same round trip as the others: read out of
// the query string, and recognised as a filter so the rows are not passed
// through untouched.
func TestTeamFilterParsing(t *testing.T) {
	f := parseListFilters(url.Values{"team_id": []string{" backend "}})
	if len(f.teamIDs) != 1 || f.teamIDs[0] != "backend" {
		t.Errorf("teamIDs = %v, want [backend]", f.teamIDs)
	}
	if f.empty() {
		t.Error("a team filter should not count as empty")
	}

	if !parseListFilters(url.Values{"team_id": []string{"  "}}).empty() {
		t.Error("a blank team_id is not a filter")
	}
}

// The value used to be discarded, mirroring APISIX. That was fine while one
// label could be chosen at a time and the browser re-filtered the page it got
// back, but #142 asks for several at once and the values are what tell them
// apart — "cors:test" and "wsdl-source-hash:62a1e60f" share no key. Matching on
// the key alone would have made every multi-select as broad as its loosest
// member.
func TestLabelFilterMatchesValueWhenOneIsGiven(t *testing.T) {
	route := map[string]any{
		"name":   "labelled",
		"labels": map[string]any{"Env": "Prod", "Region": "eu"},
	}

	cases := []struct {
		name  string
		label string
		want  bool
	}{
		{"key and value", "Env:Prod", true},
		{"wrong value for a key that exists", "Env:Staging", false},
		{"key alone still matches any value", "Env", true},
		{"value belonging to another key", "Region:Prod", false},
		{"a value containing a colon", "Env:Prod:1", false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := parseListFilters(url.Values{"label": {c.label}})
			if got := matchesListFilters(route, f); got != c.want {
				t.Errorf("label=%q = %v, want %v", c.label, got, c.want)
			}
		})
	}
}

// Several labels narrow, they do not widen: the browser used to apply them with
// .every() over the page it had been given, and moving that to the server must
// not quietly turn it into an OR.
func TestMultipleLabelsAllHaveToMatch(t *testing.T) {
	route := map[string]any{
		"name":   "labelled",
		"labels": map[string]any{"Env": "Prod", "Region": "eu"},
	}

	cases := []struct {
		name   string
		labels []string
		want   bool
	}{
		{"both present", []string{"Env:Prod", "Region:eu"}, true},
		{"one of them missing", []string{"Env:Prod", "Region:us"}, false},
		{"neither present", []string{"Env:Dev", "Region:us"}, false},
		{"one label behaves as before", []string{"Env:Prod"}, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := parseListFilters(url.Values{"label": c.labels})
			if got := matchesListFilters(route, f); got != c.want {
				t.Errorf("labels=%v = %v, want %v", c.labels, got, c.want)
			}
		})
	}
}

// Teams are the opposite case: a resource belongs to exactly one, so naming
// several can only mean "any of these".
func TestMultipleTeamsMatchAnyOfThem(t *testing.T) {
	owned := func(team string) map[string]any {
		return map[string]any{"name": "r", dashboardTeamIDField: team}
	}

	cases := []struct {
		name  string
		teams []string
		row   map[string]any
		want  bool
	}{
		{"first of two", []string{"a", "b"}, owned("a"), true},
		{"second of two", []string{"a", "b"}, owned("b"), true},
		{"neither", []string{"a", "b"}, owned("c"), false},
		{"unassigned alongside a real team", []string{"a", unassignedTeamFilter}, owned(""), true},
		{"one team behaves as before", []string{"a"}, owned("a"), true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := parseListFilters(url.Values{"team_id": c.teams})
			if got := matchesListFilters(c.row, f); got != c.want {
				t.Errorf("team_id=%v = %v, want %v", c.teams, got, c.want)
			}
		})
	}
}

// A route reaches its backend by naming an upstream, by naming a service that
// names one, or by carrying one inline with no id at all. During an incident on
// a gateway the question is which routes reach the failing upstream, so the
// second form has to resolve rather than be skipped.
func TestUpstreamFilterResolvesThroughServices(t *testing.T) {
	services := map[string]string{"svc-1": "up-a", "svc-2": "up-b"}

	direct := map[string]any{"name": "direct", "upstream_id": "up-a"}
	viaService := map[string]any{"name": "via-service", "service_id": "svc-1"}
	otherService := map[string]any{"name": "other-service", "service_id": "svc-2"}
	inline := map[string]any{"name": "inline", "upstream": map[string]any{"type": "roundrobin"}}

	cases := []struct {
		name      string
		upstreams []string
		row       map[string]any
		want      bool
	}{
		{"named directly", []string{"up-a"}, direct, true},
		{"reached through its service", []string{"up-a"}, viaService, true},
		{"a service pointing elsewhere", []string{"up-a"}, otherService, false},
		{"an inline upstream has no id to match", []string{"up-a"}, inline, false},
		{"any of several", []string{"up-a", "up-b"}, otherService, true},
		{"none of several", []string{"up-c", "up-d"}, direct, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := parseListFilters(url.Values{"upstream_id": c.upstreams})
			f.serviceUpstreams = services
			if got := matchesListFilters(c.row, f); got != c.want {
				t.Errorf("upstream_id=%v on %v = %v, want %v",
					c.upstreams, c.row["name"], got, c.want)
			}
		})
	}
}

// APISIX stores an id as whatever JSON type it arrived as: PUT /services with
// {"id": 9002} and no path segment keeps the number. One such service used to
// abort the decode of the whole list and leave the map nil, so every route
// bound to any service dropped out of an upstream filter without a word — the
// "nothing touches this upstream" answer the filter exists to avoid giving.
func TestServiceUpstreamsToleratesNumericIDs(t *testing.T) {
	body := []byte(`{"list":[
		{"value":{"id":"svc-str","upstream_id":"up-a"}},
		{"value":{"id":9002,"upstream_id":777}},
		{"value":{"id":"svc-inline"}}
	]}`)

	got, err := parseServiceUpstreams(body)
	if err != nil {
		t.Fatalf("parseServiceUpstreams: %v", err)
	}

	want := map[string]string{"svc-str": "up-a", "9002": "777"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("services[%q] = %q, want %q", k, got[k], v)
		}
	}
}

// A route can name its service or upstream numerically for the same reason.
func TestUpstreamFilterMatchesNumericIDs(t *testing.T) {
	services := map[string]string{"9002": "777"}

	cases := []struct {
		name string
		row  map[string]any
		want bool
	}{
		{"numeric upstream_id", map[string]any{"upstream_id": float64(777)}, true},
		{"numeric service_id", map[string]any{"service_id": float64(9002)}, true},
		{"string as before", map[string]any{"upstream_id": "777"}, true},
		{"a different number", map[string]any{"upstream_id": float64(778)}, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := parseListFilters(url.Values{"upstream_id": {"777"}})
			f.serviceUpstreams = services
			if got := matchesListFilters(c.row, f); got != c.want {
				t.Errorf("%v = %v, want %v", c.row, got, c.want)
			}
		})
	}
}
