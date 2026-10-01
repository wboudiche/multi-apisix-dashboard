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
	if ownerTeamID == "" {
		return false
	}
	for _, id := range s.teams {
		if id == ownerTeamID {
			return true
		}
	}
	return false
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
// Only for what a team can own (see the ownership recorded after a write): the
// types teams share, and not a write beneath a resource, which reads as the
// resource above it.
func createNeedsTeam(s teamScope, resourceType, path string) bool {
	return !s.isAdmin && s.acting == "" && teamScopedResources[resourceType] && !beneathResource(path)
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
	}
	switch {
	case named == "":
		if len(scope.teams) == 1 {
			scope.acting = scope.teams[0]
		}
	case scope.mayAccess(named):
		scope.chosen = named
		scope.acting = named
	default:
		scope.foreign = true
	}
	return scope
}
