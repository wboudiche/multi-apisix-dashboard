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
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// InstanceReader reads a registered instance. *services.InstanceService
// satisfies it; a test does not need etcd to.
type InstanceReader interface {
	GetInstance(ctx context.Context, id string) (*models.Instance, error)
}

// RequireResourcePermission refuses a caller who may not act on resourceType
// on the instance the request names.
//
// It guards the endpoints that have the dashboard open connections from its
// own network on the caller's behalf - the connection test, the route test,
// the WSDL fetch - which are for the callers who configure that resource on
// the instance and for nobody else (#307).
//
// It runs after RBACMiddleware, which leaves the caller's assignment on the
// context and refuses a viewer every non-GET. It adds what RBAC leaves open:
// an instance must be named (RBAC lets a request naming none through), it must
// exist and be active, as the proxy requires of every call it forwards, and
// the caller's role on it must carry the permission.
func RequireResourcePermission(instances InstanceReader, resourceType, action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		instanceID := GetInstanceID(c)
		if instanceID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
			c.Abort()
			return
		}

		// An assignment outlives the instance it names: DeleteInstance can
		// fail partway, and deactivating one leaves every assignment in
		// place. Neither leaves anything to configure, so neither leaves a
		// probe to run.
		instance, err := instances.GetInstance(c.Request.Context(), instanceID)
		if err != nil || instance == nil || !instance.IsActive {
			c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found or inactive"})
			c.Abort()
			return
		}

		if GetRole(c) == models.RoleSuperAdmin {
			c.Next()
			return
		}

		ui := GetUserInstance(c)
		if ui == nil || !models.HasResourcePermission(ui.Role, resourceType, action) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": fmt.Sprintf("This needs %s access to %s on this instance", action, resourceType),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
