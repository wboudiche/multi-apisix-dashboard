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

// callerTeamScope answers, for the endpoints that apply team ownership, whether
// the caller acts as an admin on this instance and which team they act for.
//
// The effective role comes from the per-instance assignment, not the JWT's
// global claim: the only global role honored is super_admin. An account whose
// User.Role was somehow set to instance_admin must not act as an admin on
// instances it has no business with.
//
// An admin's team comes from the X-Team-ID header, which is theirs to choose -
// that is how an admin works on a team's behalf - and a non-admin's from their
// assignment, which is not.
//
// One function because two endpoints apply the same rule: the proxy, for every
// Admin API path it forwards, and the route test, for the route it is asked to
// send a request to (#311).
func callerTeamScope(c *gin.Context) (isAdmin bool, teamID string) {
	ui := middleware.GetUserInstance(c)
	jwtRole := middleware.GetRole(c)

	isSuperAdmin := jwtRole == models.RoleSuperAdmin
	isInstanceAdmin := !isSuperAdmin && ui != nil && ui.Role == models.RoleInstanceAdmin
	isAdmin = isSuperAdmin || isInstanceAdmin

	switch {
	case isAdmin:
		teamID = c.GetHeader("X-Team-ID")
	case ui != nil:
		teamID = ui.TeamID
	}
	return isAdmin, teamID
}
