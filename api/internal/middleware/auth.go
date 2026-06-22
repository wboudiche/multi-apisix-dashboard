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

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

const (
	AuthorizationHeader = "Authorization"
	BearerPrefix        = "Bearer "
	UserIDKey           = "userID"
	UsernameKey         = "username"
	RoleKey             = "role"
	InstanceIDKey       = "instanceID"
)

func AuthMiddleware(authService *services.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader(AuthorizationHeader)
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		if !strings.HasPrefix(authHeader, BearerPrefix) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format"})
			c.Abort()
			return
		}

		token := strings.TrimPrefix(authHeader, BearerPrefix)

		claims, err := authService.ValidateAccessToken(token)
		if err != nil {
			if err == services.ErrTokenExpired {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token expired"})
			} else {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			}
			c.Abort()
			return
		}

		cleanUserID := strings.Trim(claims.UserID, "\"")
		c.Set(UserIDKey, cleanUserID)
		c.Set(UsernameKey, claims.Username)
		c.Set(RoleKey, claims.Role)

		c.Next()
	}
}

func GetUserID(c *gin.Context) string {
	if v, exists := c.Get(UserIDKey); exists {
		return v.(string)
	}
	return ""
}

func GetUsername(c *gin.Context) string {
	if v, exists := c.Get(UsernameKey); exists {
		return v.(string)
	}
	return ""
}

func GetRole(c *gin.Context) string {
	if v, exists := c.Get(RoleKey); exists {
		return v.(string)
	}
	return ""
}

func GetInstanceID(c *gin.Context) string {
	if v, exists := c.Get(InstanceIDKey); exists {
		return v.(string)
	}
	// Also check query param and header
	if id := c.Query("instance_id"); id != "" {
		return id
	}
	if id := c.GetHeader("X-Instance-ID"); id != "" {
		return id
	}
	return ""
}
