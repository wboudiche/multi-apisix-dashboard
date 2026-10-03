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
	"slices"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// teamScope is who a caller acts as on an instance, and for which teams.
type teamScope struct {
	// isAdmin: a super admin, or an instance admin of this instance. Nothing
	// below restricts an admin.
	isAdmin bool
	// teams are a non-admin's teams on this instance: the boundary of what
	// they may see and change.
	teams []string
	// writable are the teams among them the non-admin is a developer in:
	// what they may change, and what a create of theirs may go to
	// (#role-per-team). Reads stay with teams.
	writable []string
	// readOnly: the non-admin named one of their teams that they are a
	// viewer in. Their lists narrow to it; a create in it is refused.
	readOnly bool
	// chosen is the team a non-admin named in X-Team-ID, when it is one of
	// theirs. It narrows what a list shows, not what they may reach.
	chosen string
	// foreign: a non-admin named a team that is not theirs. The request is
	// refused rather than answered for a team it did not ask about.
	foreign bool
	// acting is the team a resource this request creates will belong to: for
	// an admin the team they named, for a non-admin the one they named or the
	// only one they have. Empty when there is none to give.
	acting string
}

// mayAccess reports whether a non-admin may see or modify a resource owned by
// ownerTeamID: it has to be one of their teams.
//
// A resource with no team is administrative territory: it is invisible and
// unwritable to non-admins until an admin assigns it (see ReassignOwnership).
// Resources predating the dashboard, or created directly against the Admin API,
// arrive in exactly that state.
//
// A caller with no team of their own passes nothing: they own no resources, and
// unowned resources must not become a free-for-all for teamless accounts.
func (s teamScope) mayAccess(ownerTeamID string) bool {
	return ownerTeamID != "" && slices.Contains(s.teams, ownerTeamID)
}

// mayWrite reports whether a non-admin may change a resource owned by
// ownerTeamID: they have to be a developer in it. A team they only view is
// theirs to read (mayAccess) and not to change.
func (s teamScope) mayWrite(ownerTeamID string) bool {
	return ownerTeamID != "" && slices.Contains(s.writable, ownerTeamID)
}

// createRefusal is what a create with no team to own it is answered: the team
// named is one the caller only views, or they have not said which of several
// they may write to.
func createRefusal(s teamScope) (int, string, string) {
	if s.readOnly {
		return http.StatusForbidden, teamReadOnlyMsg, teamReadOnlyCode
	}
	return http.StatusBadRequest, teamRequiredMsg, teamRequiredCode
}

// lists reports whether a non-admin's list shows a resource owned by
// ownerTeamID: everything they may access, or the one team they named. The
// same view an admin has of "all teams" and of one, within the caller's own.
func (s teamScope) lists(ownerTeamID string) bool {
	if s.chosen != "" {
		return ownerTeamID == s.chosen
	}
	return s.mayAccess(ownerTeamID)
}

// createNeedsTeam reports whether a non-admin's create has to be refused for
// want of a team to own it. A resource has one owner; a caller with several
// teams and none named has not said which, and one with no team has none to
// give. Written anyway, the resource would carry no owner and disappear from
// its own author, since unowned is admin-only.
//
// Only for a method that creates - a POST to a collection, or a PUT to an id
// the caller has found not to exist. A DELETE or a PATCH of something that is
// not there creates nothing, and is the gateway's to answer with its 404.
//
// And only for what a team can own (see the ownership recorded after a write):
// the types teams share, and not a write beneath a resource, which reads as
// the resource above it.
func createNeedsTeam(s teamScope, method, resourceType, path string) bool {
	creates := method == http.MethodPost || method == http.MethodPut
	return creates && !s.isAdmin && s.acting == "" && teamScopedResources[resourceType] && !beneathResource(path)
}

// callerTeamScope answers, for the endpoints that apply team ownership, whether
// the caller acts as an admin on this instance and which teams they act for.
//
// The effective role comes from the per-instance assignment, not the JWT's
// global claim: the only global role honored is super_admin. An account whose
// User.Role was somehow set to instance_admin must not act as an admin on
// instances it has no business with.
//
// An admin's team comes from the X-Team-ID header, which is theirs to choose -
// that is how an admin works on a team's behalf. A non-admin's teams come from
// their assignment, which is not theirs to choose; the header only says which
// of those teams a request is for (#301).
//
// One function because two endpoints apply the same rule: the proxy, for every
// Admin API path it forwards, and the route test, for the route it is asked to
// send a request to (#311).
func callerTeamScope(c *gin.Context) teamScope {
	ui := middleware.GetUserInstance(c)
	jwtRole := middleware.GetRole(c)
	named := c.GetHeader("X-Team-ID")

	isSuperAdmin := jwtRole == models.RoleSuperAdmin
	isInstanceAdmin := !isSuperAdmin && ui != nil && ui.Role == models.RoleInstanceAdmin
	if isSuperAdmin || isInstanceAdmin {
		return teamScope{isAdmin: true, acting: named}
	}

	var scope teamScope
	if ui != nil {
		scope.teams = ui.TeamIDs
		scope.writable = ui.WritableTeams()
	}
	switch {
	case named == "":
		// Their only team they may write to: with one, nothing to choose.
		if len(scope.writable) == 1 {
			scope.acting = scope.writable[0]
		}
	case scope.mayAccess(named):
		scope.chosen = named
		if scope.mayWrite(named) {
			scope.acting = named
		} else {
			scope.readOnly = true
		}
	default:
		scope.foreign = true
	}
	return scope
}
