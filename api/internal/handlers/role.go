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

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"

	"github.com/gin-gonic/gin"
)

// RoleHandler handles role-related requests
type RoleHandler struct{}

func NewRoleHandler() *RoleHandler {
	return &RoleHandler{}
}

// ListRoles returns all available roles and their permissions
func (h *RoleHandler) ListRoles(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	roles := []gin.H{
		{
			"name":        models.RoleSuperAdmin,
			"description": "Full access to all resources",
			"permissions": models.RolePermissions[models.RoleSuperAdmin],
		},
		{
			"name":        models.RoleInstanceAdmin,
			"description": "Full access to assigned instances",
			"permissions": models.RolePermissions[models.RoleInstanceAdmin],
		},
		{
			"name":        models.RoleDeveloper,
			"description": "Read-write access to assigned instances",
			"permissions": models.RolePermissions[models.RoleDeveloper],
		},
		{
			"name":        models.RoleViewer,
			"description": "Read-only access to assigned instances",
			"permissions": models.RolePermissions[models.RoleViewer],
		},
	}

	c.JSON(http.StatusOK, roles)
}
