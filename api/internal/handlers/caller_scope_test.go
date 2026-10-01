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
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// scopeOf runs callerTeamScope on what the middleware leaves on the context:
// the JWT's role, the caller's assignment on the instance, and the team header.
func scopeOf(jwtRole string, ui *models.UserInstance, header string) teamScope {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		c.Request.Header.Set("X-Team-ID", header)
	}
	c.Set(middleware.RoleKey, jwtRole)
	if ui != nil {
		c.Set(middleware.UserInstanceKey, ui)
	}
	return callerTeamScope(c)
}

func developerOn(teams ...string) *models.UserInstance {
	return &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: teams}
}

// A user can work for several teams on one instance (#301). Which team a
// request is for is then the caller's to say, within the teams they have, and
// only there: for a non-admin the teams are the access boundary.
func TestCallerTeamScope(t *testing.T) {
	cases := []struct {
		name    string
		jwtRole string
		ui      *models.UserInstance
		header  string
		want    teamScope
	}{
		{
			name:    "a super admin acts for the team they name",
			jwtRole: models.RoleSuperAdmin, header: "team-x",
			want: teamScope{isAdmin: true, acting: "team-x"},
		},
		{
			name:    "a super admin naming none acts for none",
			jwtRole: models.RoleSuperAdmin,
			want:    teamScope{isAdmin: true},
		},
		{
			name:    "an instance admin acts for the team they name, whatever their assignment holds",
			jwtRole: models.RoleDeveloper,
			ui:      &models.UserInstance{Role: models.RoleInstanceAdmin, TeamIDs: []string{"team-a"}},
			header:  "team-x",
			want:    teamScope{isAdmin: true, acting: "team-x"},
		},
		{
			// The JWT's role is not the instance's: only super_admin is honoured
			// from it.
			name:    "a global instance_admin claim does not make an admin of a developer",
			jwtRole: models.RoleInstanceAdmin, ui: developerOn("team-a"),
			want: teamScope{teams: []string{"team-a"}, acting: "team-a"},
		},
		{
			// What every assignment was before the list: nothing to choose.
			name:    "one team needs no choosing",
			jwtRole: models.RoleDeveloper, ui: developerOn("team-a"),
			want: teamScope{teams: []string{"team-a"}, acting: "team-a"},
		},
		{
			name:    "one team, named",
			jwtRole: models.RoleDeveloper, ui: developerOn("team-a"), header: "team-a",
			want: teamScope{teams: []string{"team-a"}, chosen: "team-a", acting: "team-a"},
		},
		{
			// Sees both; what it creates has no owner to be given until it says.
			name:    "several teams and none named",
			jwtRole: models.RoleDeveloper, ui: developerOn("team-a", "team-b"),
			want: teamScope{teams: []string{"team-a", "team-b"}},
		},
		{
			name:    "several teams, one of them named",
			jwtRole: models.RoleDeveloper, ui: developerOn("team-a", "team-b"), header: "team-b",
			want: teamScope{teams: []string{"team-a", "team-b"}, chosen: "team-b", acting: "team-b"},
		},
		{
			// Not ignored, and not answered as if for their own team: the
			// request asked for something the caller cannot have.
			name:    "a team that is not theirs",
			jwtRole: models.RoleDeveloper, ui: developerOn("team-a", "team-b"), header: "team-x",
			want: teamScope{teams: []string{"team-a", "team-b"}, foreign: true},
		},
		{
			name:    "a team that is not theirs, with one team of their own",
			jwtRole: models.RoleDeveloper, ui: developerOn("team-a"), header: "team-x",
			want: teamScope{teams: []string{"team-a"}, foreign: true},
		},
		{
			name:    "no team at all",
			jwtRole: models.RoleViewer, ui: &models.UserInstance{Role: models.RoleViewer},
			want: teamScope{},
		},
		{
			name:    "no assignment",
			jwtRole: models.RoleDeveloper, header: "team-a",
			want: teamScope{foreign: true},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scopeOf(tc.jwtRole, tc.ui, tc.header)
			// nil and empty are the same list of teams.
			if len(got.teams) == 0 {
				got.teams = nil
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

// The boundary is the caller's teams, all of them: naming one narrows what a
// list shows, not what they may reach.
func TestTeamScopeAccessAndListing(t *testing.T) {
	both := teamScope{teams: []string{"team-a", "team-b"}}
	narrowed := teamScope{teams: []string{"team-a", "team-b"}, chosen: "team-b", acting: "team-b"}
	none := teamScope{}

	cases := []struct {
		name       string
		scope      teamScope
		owner      string
		mayAccess  bool
		listsOwner bool
	}{
		{"one of their teams", both, "team-a", true, true},
		{"the other of their teams", both, "team-b", true, true},
		{"another team", both, "team-c", false, false},
		// Administrative territory until an admin assigns it, whoever asks.
		{"unowned", both, "", false, false},
		// Still theirs to open and to change; only the list leaves it out.
		{"their team, but not the one named", narrowed, "team-a", true, false},
		{"the one named", narrowed, "team-b", true, true},
		{"another team, with one named", narrowed, "team-c", false, false},
		{"unowned, with one named", narrowed, "", false, false},
		// A caller with no team owns nothing, and unowned resources must not
		// become a free-for-all for teamless accounts.
		{"no team, resource owned", none, "team-a", false, false},
		{"no team, resource unowned", none, "", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.scope.mayAccess(tc.owner); got != tc.mayAccess {
				t.Errorf("mayAccess(%q) = %v, want %v", tc.owner, got, tc.mayAccess)
			}
			if got := tc.scope.lists(tc.owner); got != tc.listsOwner {
				t.Errorf("lists(%q) = %v, want %v", tc.owner, got, tc.listsOwner)
			}
		})
	}
}

// A resource has one owner, so creating one needs one team to give it. With
// none, the resource would be written with no owner and vanish from its own
// author: unowned is admin-only.
func TestCreateNeedsATeam(t *testing.T) {
	admin := teamScope{isAdmin: true}
	undecided := teamScope{teams: []string{"team-a", "team-b"}}
	decided := teamScope{teams: []string{"team-a", "team-b"}, chosen: "team-a", acting: "team-a"}
	teamless := teamScope{}

	cases := []struct {
		name         string
		scope        teamScope
		resourceType string
		path         string
		want         bool
	}{
		{"several teams, none named", undecided, "routes", "/routes", true},
		{"several teams, none named, a PUT to an id", undecided, "consumers", "/consumers/alice", true},
		{"no team at all", teamless, "routes", "/routes", true},
		{"one named", decided, "routes", "/routes", false},
		// An admin with no team named creates an unassigned resource, as before.
		{"an admin naming none", admin, "routes", "/routes", false},
		// Nothing records an owner for these, so there is nothing to choose.
		{"a type teams do not share", undecided, "plugin_metadata", "/plugin_metadata/x", false},
		// A credential reads as its consumer, which already has its team.
		{"beneath a resource", undecided, "consumers", "/consumers/alice/credentials/k", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := createNeedsTeam(tc.scope, tc.resourceType, tc.path); got != tc.want {
				t.Errorf("createNeedsTeam = %v, want %v", got, tc.want)
			}
		})
	}
}
