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
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

const (
	routeWithSecret    = `{"key":"/apisix/routes/%s","value":{"id":"%s","uri":"/x","plugins":{"openid-connect":{"client_id":"c","client_secret":"THE-SECRET"}}}}`
	consumerWithKey    = `{"key":"/apisix/consumers/u","value":{"username":"u","plugins":{"key-auth":{"key":"THE-SECRET"}}}}`
	globalRuleWithAuth = `{"key":"/apisix/global_rules/1","value":{"id":"1","plugins":{"basic-auth":{"password":"THE-SECRET"}}}}`
)

func route(id string) string {
	return strings.ReplaceAll(routeWithSecret, "%s", id)
}

// proxyRead sends a GET through ProxyRequest, as role (and, for a non super
// admin, the assignment ui) on instance i1, to a fake Admin API answering
// upstream; owners are the ownership records of the type read.
func proxyRead(t *testing.T, role string, ui *models.UserInstance, path, upstream string, owners map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(upstream))
	}))
	t.Cleanup(srv.Close)

	h := NewProxyHandler(nil, nil, nil)
	h.getInstance = func(_ context.Context, id string) (*models.Instance, error) {
		return &models.Instance{ID: id, AdminAPIURL: srv.URL, AdminKey: "k", IsActive: true}, nil
	}
	h.getOwner = func(_ context.Context, _, _, id string) (string, error) { return owners[id], nil }
	h.listOwners = func(_ context.Context, _, _ string) (map[string]string, error) { return owners, nil }

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/apisix/admin"+path, nil)
	c.Params = gin.Params{{Key: "path", Value: path}}
	c.Set(middleware.InstanceIDKey, "i1")
	c.Set(middleware.RoleKey, role)
	if ui != nil {
		c.Set(middleware.UserInstanceKey, ui)
	}
	h.ProxyRequest(c)
	return w
}

func viewerIn(teams ...string) *models.UserInstance {
	return &models.UserInstance{InstanceID: "i1", Role: models.RoleViewer, TeamIDs: teams}
}

func developerIn(teams ...string) *models.UserInstance {
	return &models.UserInstance{InstanceID: "i1", Role: models.RoleDeveloper, TeamIDs: teams}
}

func TestProxyReadRedactsCredentials(t *testing.T) {
	owners := map[string]string{"r1": "t1", "r2": "t2", "u": "t1"}
	// A developer in t1 who only views t2 (#394).
	mixed := &models.UserInstance{
		InstanceID: "i1", Role: models.RoleDeveloper, TeamIDs: []string{"t1", "t2"},
		TeamRoles: map[string]string{"t1": models.RoleDeveloper, "t2": models.RoleViewer},
	}
	instanceAdmin := &models.UserInstance{InstanceID: "i1", Role: models.RoleInstanceAdmin}
	routeList := `{"total":2,"list":[` + route("r1") + `,` + route("r2") + `]}`

	tests := []struct {
		name     string
		role     string
		ui       *models.UserInstance
		path     string
		upstream string
		// shown: how many times the answer still carries the secret.
		// Where none, a marker stands in its place.
		shown int
	}{
		{"viewer, route detail", models.RoleViewer, viewerIn("t1"), "/routes/r1", route("r1"), 0},
		{"viewer, route list", models.RoleViewer, viewerIn("t1", "t2"), "/routes", routeList, 0},
		{"viewer, consumer", models.RoleViewer, viewerIn("t1"), "/consumers/u", consumerWithKey, 0},
		{"viewer, global rule", models.RoleViewer, viewerIn("t1"), "/global_rules/1", globalRuleWithAuth, 0},
		{"developer, own route", models.RoleDeveloper, developerIn("t1"), "/routes/r1", route("r1"), 1},
		{"developer, own consumer", models.RoleDeveloper, developerIn("t1"), "/consumers/u", consumerWithKey, 1},
		{"developer in t1 viewing t2, t2's route", models.RoleDeveloper, mixed, "/routes/r2", route("r2"), 0},
		{"developer in t1 viewing t2, t1's route", models.RoleDeveloper, mixed, "/routes/r1", route("r1"), 1},
		{"developer in t1 viewing t2, list: t1's row only", models.RoleDeveloper, mixed, "/routes", routeList, 1},
		{"instance admin, route list", models.RoleViewer, instanceAdmin, "/routes", routeList, 2},
		{"instance admin, global rule", models.RoleViewer, instanceAdmin, "/global_rules/1", globalRuleWithAuth, 1},
		{"super admin, route", models.RoleSuperAdmin, nil, "/routes/r2", route("r2"), 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := proxyRead(t, tt.role, tt.ui, tt.path, tt.upstream, owners)
			if w.Code != http.StatusOK {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			body := w.Body.String()
			if got := strings.Count(body, "THE-SECRET"); got != tt.shown {
				t.Errorf("secret shown %d times, want %d: %s", got, tt.shown, body)
			}
			if tt.shown == 0 && !strings.Contains(body, `"***"`) {
				t.Errorf("no marker in place of the secret: %s", body)
			}
			if cl := w.Header().Get("Content-Length"); cl != "" && cl != strconv.Itoa(len(body)) {
				t.Errorf("Content-Length %s for a body of %d bytes", cl, len(body))
			}
		})
	}
}
