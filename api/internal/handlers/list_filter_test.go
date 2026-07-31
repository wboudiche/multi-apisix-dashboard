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
		if f.name != "Billing" || f.uri != "/services" || f.label != "Env:Prod" {
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
		{"Env", true},
		{"env", true},         // case-insensitive, unlike APISIX
		{"Env:Prod", true},    // value part ignored, as APISIX does
		{"Env:Staging", true}, // ...so this matches too
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
			if got := matchesTeam(tt.value, tt.want); got != tt.match {
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
	if f.teamID != "backend" {
		t.Errorf("teamID = %q, want %q", f.teamID, "backend")
	}
	if f.empty() {
		t.Error("a team filter should not count as empty")
	}

	if !parseListFilters(url.Values{"team_id": []string{"  "}}).empty() {
		t.Error("a blank team_id is not a filter")
	}
}
