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
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// The endpoints this guards - a connection test, a route test, a WSDL fetch -
// have the dashboard open connections from its own network on the caller's
// behalf. They are for the callers who configure that resource on the
// instance, and for nobody else (#307).

type stubInstances struct {
	instances map[string]*models.Instance
	err       error
}

func (s stubInstances) GetInstance(_ context.Context, id string) (*models.Instance, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.instances[id], nil
}

const (
	activeInstance   = "i-active"
	inactiveInstance = "i-inactive"
)

func newPermissionRouter(t *testing.T, instances InstanceReader, role string, ui *models.UserInstance) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	// What AuthMiddleware and RBACMiddleware leave behind.
	r.Use(func(c *gin.Context) {
		c.Set(RoleKey, role)
		if ui != nil {
			c.Set(UserInstanceKey, ui)
		}
		c.Next()
	})
	r.POST("/probe", RequireResourcePermission(instances, "routes", "write"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

func probe(t *testing.T, instances InstanceReader, role string, ui *models.UserInstance, instanceID string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/probe", nil)
	if instanceID != "" {
		req.Header.Set("X-Instance-ID", instanceID)
	}
	w := httptest.NewRecorder()
	newPermissionRouter(t, instances, role, ui).ServeHTTP(w, req)
	return w.Code
}

func assigned(role string) *models.UserInstance {
	return &models.UserInstance{UserID: "u1", InstanceID: activeInstance, Role: role}
}

func TestRequireResourcePermission(t *testing.T) {
	instances := stubInstances{instances: map[string]*models.Instance{
		activeInstance:   {ID: activeInstance, IsActive: true},
		inactiveInstance: {ID: inactiveInstance, IsActive: false},
	}}

	for _, tc := range []struct {
		name       string
		role       string
		ui         *models.UserInstance
		instanceID string
		want       int
	}{
		{"super admin", models.RoleSuperAdmin, nil, activeInstance, http.StatusOK},
		{"instance admin", "", assigned(models.RoleInstanceAdmin), activeInstance, http.StatusOK},
		{"developer", "", assigned(models.RoleDeveloper), activeInstance, http.StatusOK},
		// A viewer reads routes; it does not write them.
		{"viewer", "", assigned(models.RoleViewer), activeInstance, http.StatusForbidden},
		// RBACMiddleware lets a request naming no instance through.
		{"no instance named", "", assigned(models.RoleDeveloper), "", http.StatusBadRequest},
		{"no instance named, super admin", models.RoleSuperAdmin, nil, "", http.StatusBadRequest},
		// No assignment: RBACMiddleware refuses this, but only once an
		// instance is named, and nothing else would.
		{"no role on the instance", "", nil, activeInstance, http.StatusForbidden},
		// The proxy refuses an instance that is gone or switched off, so an
		// assignment left behind by one must not still open a probe.
		{"inactive instance", "", assigned(models.RoleDeveloper), inactiveInstance, http.StatusNotFound},
		{"unknown instance", "", assigned(models.RoleDeveloper), "i-gone", http.StatusNotFound},
		{"inactive instance, super admin", models.RoleSuperAdmin, nil, inactiveInstance, http.StatusNotFound},
	} {
		if got := probe(t, instances, tc.role, tc.ui, tc.instanceID); got != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, got, tc.want)
		}
	}
}

// The instance store failing is not the caller's answer to guess at, and it is
// certainly not permission to probe.
func TestRequireResourcePermissionRefusesWhenTheInstanceCannotBeRead(t *testing.T) {
	instances := stubInstances{err: errors.New("etcd is away")}
	if got := probe(t, instances, models.RoleSuperAdmin, nil, activeInstance); got != http.StatusNotFound {
		t.Errorf("status %d, want %d", got, http.StatusNotFound)
	}
}

// The action is part of the check, not decoration: a role that may read the
// resource but not write it is refused a write.
func TestRequireResourcePermissionChecksTheAction(t *testing.T) {
	instances := stubInstances{instances: map[string]*models.Instance{
		activeInstance: {ID: activeInstance, IsActive: true},
	}}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(RoleKey, "")
		c.Set(UserInstanceKey, assigned(models.RoleViewer))
		c.Next()
	})
	r.GET("/read", RequireResourcePermission(instances, "routes", "read"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/read", nil)
	req.Header.Set("X-Instance-ID", activeInstance)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("a viewer reading routes: status %d, want %d", w.Code, http.StatusOK)
	}
}
