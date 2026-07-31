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
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

// MustChangeLookup reports whether the user still has to change their
// password. It is a function (rather than a service dependency) so the gate
// can be unit-tested without etcd.
type MustChangeLookup func(ctx context.Context, userID string) (bool, error)

// passwordChangeExempt lists the endpoints a user is allowed to reach while a
// password change is pending: reading their own profile, performing the
// change itself (and the policy it must satisfy), and logging out.
func passwordChangeExempt(method, path string) bool {
	switch {
	case method == http.MethodGet && path == "/api/v1/user":
		return true
	case method == http.MethodPost && path == "/api/v1/user/password":
		return true
	case method == http.MethodPost && path == "/api/v1/logout":
		return true
	case method == http.MethodGet && path == "/api/v1/settings/password-policy":
		return true
	}
	return false
}

// ForcePasswordChange rejects requests from users flagged with
// MustChangePassword until they change their password. It must run after
// AuthMiddleware (it relies on the user ID stamped on the context).
//
// Lookup failures fail open: this gate is a UX enforcement layer, not the
// auth boundary — if the user record cannot be read, downstream handlers
// hitting the same store will surface the real error.
func ForcePasswordChange(lookup MustChangeLookup) gin.HandlerFunc {
	return func(c *gin.Context) {
		if passwordChangeExempt(c.Request.Method, c.Request.URL.Path) {
			c.Next()
			return
		}

		userID := GetUserID(c)
		if userID == "" {
			c.Next()
			return
		}

		mustChange, err := lookup(c.Request.Context(), userID)
		if err != nil {
			c.Next()
			return
		}
		if mustChange {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "Password change required",
				"code":  "password_change_required",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
