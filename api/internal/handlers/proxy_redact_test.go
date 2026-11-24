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
	return proxyReadFrom(t, role, ui, path, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(upstream))
	}, owners, nil)
}

// proxyReadFrom is proxyRead against an Admin API of the test's own, with
// headers added to the browser's request.
func proxyReadFrom(t *testing.T, role string, ui *models.UserInstance, path string,
	upstream http.HandlerFunc, owners map[string]string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	srv := httptest.NewServer(upstream)
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
	for k, v := range headers {
		c.Request.Header.Set(k, v)
	}
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

// An answer the proxy cannot read cannot be told free of credentials: a
// caller whose answer is redacted gets an error in its place, never the
// answer (fail closed). A writer, whose answer is not redacted, gets it as
// APISIX sent it.
func TestProxyReadFailsClosedOnAnAnswerItCannotRead(t *testing.T) {
	owners := map[string]string{"r1": "t1"}
	answers := map[string]http.HandlerFunc{
		"not JSON": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`client_secret=THE-SECRET`))
		},
		"trailing garbage": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(route("r1") + ` THE-SECRET`))
		},
		"an encoding nobody asked for": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Encoding", "br")
			_, _ = w.Write([]byte("\x8b\x00THE-SECRET\x03"))
		},
	}
	for name, upstream := range answers {
		for _, path := range []string{"/routes/r1", "/routes", "/global_rules/1"} {
			t.Run(name+" "+path, func(t *testing.T) {
				w := proxyReadFrom(t, models.RoleViewer, viewerIn("t1"), path, upstream, owners, nil)
				if w.Code != http.StatusBadGateway {
					t.Errorf("status %d, want 502", w.Code)
				}
				if strings.Contains(w.Body.String(), "THE-SECRET") {
					t.Errorf("answered the body: %s", w.Body.String())
				}
				if w.Header().Get("Content-Encoding") != "" {
					t.Errorf("Content-Encoding %q on the error", w.Header().Get("Content-Encoding"))
				}
			})
		}
		t.Run(name+" for a writer", func(t *testing.T) {
			w := proxyReadFrom(t, models.RoleDeveloper, developerIn("t1"), "/routes/r1", upstream, owners, nil)
			if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "THE-SECRET") {
				t.Errorf("status %d, body %q", w.Code, w.Body.String())
			}
		})
	}
}

// The browser's Accept-Encoding is not the proxy's: APISIX answers the proxy
// in an encoding it can read and redact, and the browser gets it decoded.
func TestProxyReadAsksAPISIXForAnAnswerItCanRead(t *testing.T) {
	var asked []string
	upstream := func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.Header.Get("Accept-Encoding"))
		if strings.Contains(r.Header.Get("Accept-Encoding"), "br") {
			w.Header().Set("Content-Encoding", "br")
			_, _ = w.Write([]byte("\x8b\x00\x03"))
			return
		}
		_, _ = w.Write([]byte(route("r1")))
	}
	w := proxyReadFrom(t, models.RoleViewer, viewerIn("t1"), "/routes/r1", upstream,
		map[string]string{"r1": "t1"}, map[string]string{"Accept-Encoding": "br, gzip"})
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "THE-SECRET") ||
		!strings.Contains(w.Body.String(), `"***"`) {
		t.Errorf("status %d, body %s (APISIX was asked for %q)", w.Code, w.Body.String(), asked)
	}
}
