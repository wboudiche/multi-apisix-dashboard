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

package middleware

import (
	"net/http"
	"strings"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

const (
	UserInstanceKey = "userInstance"
)

func RBACMiddleware(authService *services.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := GetRole(c)
		if role == models.RoleSuperAdmin {
			c.Next()
			return
		}

		userID := GetUserID(c)
		instanceID := GetInstanceID(c)

		if instanceID == "" {
			c.Next()
			return
		}

		ui, err := authService.GetUserInstance(c.Request.Context(), userID, instanceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Authorization check failed"})
			c.Abort()
			return
		}

		// TODO: remove these fallbacks once the etcd migration to canonical (unquoted)
		// user_instance keys has run. They mask data corruption from an earlier bug
		// where some keys got written with surrounding quotes.
		if ui == nil {
			ui, _ = authService.GetUserInstance(c.Request.Context(), "\""+userID+"\"", instanceID)
		}
		if ui == nil {
			ui, _ = authService.GetUserInstance(c.Request.Context(), strings.Trim(userID, "\""), instanceID)
		}
		if ui == nil {
			nestedQuoted := "\"\\\"" + strings.Trim(userID, "\"") + "\\\"\""
			ui, _ = authService.GetUserInstance(c.Request.Context(), nestedQuoted, instanceID)
		}

		if ui == nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied for this instance"})
			c.Abort()
			return
		}

		c.Set(UserInstanceKey, ui)

		if ui.Role == models.RoleViewer && c.Request.Method != http.MethodGet {
			c.JSON(http.StatusForbidden, gin.H{"error": "Read-only access"})
			c.Abort()
			return
		}

		c.Next()
	}
}

func GetUserInstance(c *gin.Context) *models.UserInstance {
	if v, exists := c.Get(UserInstanceKey); exists {
		return v.(*models.UserInstance)
	}
	return nil
}

func GetTeamID(c *gin.Context) string {
	if ui := GetUserInstance(c); ui != nil {
		return ui.TeamID
	}
	return ""
}
