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
	"strconv"
	"strings"
)

// Filtering list responses on the dashboard's side rather than APISIX's.
//
// APISIX can filter a list by name, uri and label, but only case-sensitively —
// so searching "billing" hid a route plainly called "BillingService" — and it
// has no notion of status at all: ?status=1 is simply ignored and every route
// comes back. Both are reported in issue #50.
//
// Doing it here also fixes the ordering problem behind a second bug: the
// ownership filter used to run on whatever page APISIX had already paginated,
// then overwrote the total with the count of that page, so a non-admin could
// never reach their own resources past the first page. Filtering has to happen
// before pagination, which means pagination has to happen here too.

// listFilterParams are the query parameters this layer consumes. They are
// stripped from the upstream request so APISIX cannot apply its own
// case-sensitive version first and leave nothing to match.
var listFilterParams = []string{"name", "uri", "label", "status", "team_id"}

// paginationParams are removed from the upstream request as well: filtering has
// to see every row, so the page is cut here afterwards.
var paginationParams = []string{"page", "page_size"}

// unassignedTeamFilter asks for the resources that belong to no team.
//
// Those are a real category rather than an oddity: they are invisible to every
// non-admin until assigned (see nonAdminMayAccess), and detaching one is now a
// deliberate action, so an admin needs a way to find them. A reserved token
// rather than an empty value, which already means "no filter at all".
const unassignedTeamFilter = "__none__"

type listFilters struct {
	name   string
	uri    string
	label  string
	status *int
	teamID string
}

// parseListFilters reads the dashboard filters out of a query string. A blank
// value is not a filter, and a status that is not a number is ignored rather
// than turned into a filter that matches nothing.
func parseListFilters(q url.Values) listFilters {
	f := listFilters{
		name:   strings.TrimSpace(q.Get("name")),
		uri:    strings.TrimSpace(q.Get("uri")),
		label:  strings.TrimSpace(q.Get("label")),
		teamID: strings.TrimSpace(q.Get("team_id")),
	}
	if raw := strings.TrimSpace(q.Get("status")); raw != "" {
		if status, err := strconv.Atoi(raw); err == nil {
			f.status = &status
		}
	}
	return f
}

func (f listFilters) empty() bool {
	return f.name == "" && f.uri == "" && f.label == "" && f.status == nil &&
		f.teamID == ""
}

func containsFold(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func stringField(value map[string]any, key string) string {
	s, _ := value[key].(string)
	return s
}

// matchesURI reports whether any path the resource answers on contains the
// search text. A resource may use `uri` or `uris`, and either may be the one the
// operator remembers.
func matchesURI(value map[string]any, needle string) bool {
	if containsFold(stringField(value, "uri"), needle) {
		return true
	}
	uris, _ := value["uris"].([]any)
	for _, u := range uris {
		if s, ok := u.(string); ok && containsFold(s, needle) {
			return true
		}
	}
	return false
}

// matchesStatus compares a resource against the requested status.
//
// A resource created without a status has no status field, and APISIX treats
// that as enabled. Matching only an explicit 1 would drop those rows from the
// Published filter, which is the same silent omission this change exists to end.
func matchesStatus(value map[string]any, want int) bool {
	raw, present := value["status"]
	if !present || raw == nil {
		return want == 1
	}
	switch v := raw.(type) {
	case float64:
		return int(v) == want
	case int:
		return v == want
	default:
		return false
	}
}

// matchesLabel reports whether the resource carries the requested label.
//
// APISIX matches on the key alone and ignores anything after a colon; that is
// preserved so moving the filter here does not quietly change which rows a
// saved filter returns. The comparison is case-insensitive, unlike APISIX's.
func matchesLabel(value map[string]any, needle string) bool {
	key := needle
	if before, _, found := strings.Cut(needle, ":"); found {
		key = before
	}

	labels, _ := value["labels"].(map[string]any)
	for k := range labels {
		if strings.EqualFold(k, key) {
			return true
		}
	}
	return false
}

// matchesListFilters reports whether one resource satisfies every filter given.
func matchesListFilters(value map[string]any, f listFilters) bool {
	if f.name != "" && !containsFold(stringField(value, "name"), f.name) {
		return false
	}
	if f.uri != "" && !matchesURI(value, f.uri) {
		return false
	}
	if f.label != "" && !matchesLabel(value, f.label) {
		return false
	}
	if f.status != nil && !matchesStatus(value, *f.status) {
		return false
	}
	if f.teamID != "" && !matchesTeam(value, f.teamID) {
		return false
	}
	return true
}

// matchesTeam compares a row against the requested owning team.
//
// The owner is read from the field the proxy injects just above this call, not
// from the resource itself: APISIX knows nothing about teams, and ownership
// lives in the dashboard's own store.
func matchesTeam(value map[string]any, want string) bool {
	owner, _ := value[dashboardTeamIDField].(string)
	if want == unassignedTeamFilter {
		return owner == ""
	}
	return owner == want
}

// paginateRows returns the requested page of rows.
//
// A missing or nonsensical page falls back to returning everything: an operator
// who asked for no particular page should see the list, not an empty table.
func paginateRows(rows []map[string]any, page, pageSize int) []map[string]any {
	if page < 1 || pageSize < 1 {
		return rows
	}

	start := (page - 1) * pageSize
	if start >= len(rows) {
		return []map[string]any{}
	}
	end := start + pageSize
	if end > len(rows) {
		end = len(rows)
	}
	return rows[start:end]
}
