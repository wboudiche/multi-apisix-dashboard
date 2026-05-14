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
	"log"
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
		log.Printf("[DEBUG RBAC] Entering middleware")
		role := GetRole(c)
		if role == models.RoleSuperAdmin {
			log.Printf("[DEBUG RBAC] SuperAdmin bypass")
			c.Next()
			return
		}

		userID := GetUserID(c)
		instanceID := GetInstanceID(c)
		log.Printf("[DEBUG RBAC] Context: UserID=%s, InstanceID=%s", userID, instanceID)

		if instanceID == "" {
			log.Printf("[DEBUG RBAC] No instance ID, bypass")
			c.Next()
			return
		}

		// Get the user's specific role and scope for this instance
		ui, err := authService.GetUserInstance(c.Request.Context(), userID, instanceID)
		if err != nil {
			log.Printf("[DEBUG RBAC] Failed to get user instance role: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Authorization check failed"})
			c.Abort()
			return
		}

		if ui == nil {
			// Fallback: try with quoted userID (there might be a mix in etcd due to earlier bugs)
			log.Printf("[DEBUG RBAC] UI nil for %s, trying quoted", userID)
			ui, _ = authService.GetUserInstance(c.Request.Context(), "\""+userID+"\"", instanceID)
		}

		if ui == nil {
			// Fallback: try removing quotes from userID
			cleanID := strings.Trim(userID, "\"")
			log.Printf("[DEBUG RBAC] UI nil, trying cleaned ID: %s", cleanID)
			ui, _ = authService.GetUserInstance(c.Request.Context(), cleanID, instanceID)
		}

		// Double fallback for the specific case found in etcd: "fb1a..." (nested quotes)
		if ui == nil {
			nestedQuoted := "\"\\\"" + strings.Trim(userID, "\"") + "\\\"\""
			log.Printf("[DEBUG RBAC] Trying nested quoted: %s", nestedQuoted)
			ui, _ = authService.GetUserInstance(c.Request.Context(), nestedQuoted, instanceID)
		}

		if ui == nil {
			log.Printf("[DEBUG RBAC] User %s has no access to instance %s", userID, instanceID)
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied for this instance"})
			c.Abort()
			return
		}

		log.Printf("[DEBUG RBAC] Found UI assignment: Role=%s, HasScope=%v", ui.Role, ui.Scope != nil)
		if ui.Scope != nil {
			log.Printf("[DEBUG RBAC] Scope detail: Tags=%v, PathPrefixes=%v", ui.Scope.Tags, ui.Scope.PathPrefixes)
		}
		// Store the user instance assignment in context for later scope checks
		c.Set(UserInstanceKey, ui)

		// Basic method-based RBAC
		method := c.Request.Method
		if ui.Role == models.RoleViewer && method != http.MethodGet {
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
