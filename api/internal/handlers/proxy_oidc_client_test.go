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
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

// oidcProxyFixture runs ProxyRequest over an in-memory store, with a fake
// Admin API holding the routes in existing.
type oidcProxyFixture struct {
	h         *ProxyHandler
	store     *memStore
	owners    *services.OwnershipService
	idps      *services.IdPService
	idpID     string
	mu        sync.Mutex
	existing  map[string]bool
	forwarded []string // writes that reached the gateway
}

func newOIDCProxyFixture(t *testing.T) *oidcProxyFixture {
	t.Helper()
	f := &oidcProxyFixture{store: &memStore{}, existing: map[string]bool{"r1": true, "r2": true}}
	f.owners = services.NewOwnershipService(f.store)
	f.idps = services.NewIdPService(f.store)
	ctx := context.Background()
	p := &models.IdentityProvider{
		Name: "kc", Type: models.IdPTypeKeycloak, BaseURL: "https://sso.test", Realm: "r",
		AdminClientID: "adm", AdminClientSecret: "s3cr3t", ClientIDPrefix: "mad-",
		InstanceIDs: []string{"i1"},
	}
	if err := f.idps.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	f.idpID = p.ID
	for route, team := range map[string]string{"r1": "t1", "r2": "t2"} {
		if err := f.owners.SetOwner(ctx, &models.Ownership{InstanceID: "i1", ResourceType: "routes", ResourceID: route, TeamID: team}); err != nil {
			t.Fatal(err)
		}
	}
	f.client(t, "c1", "r1", 100)
	f.client(t, "c2", "r2", 100)
	f.client(t, "c3", "r1", 0) // detached: its route was deleted
	// A client of another instance, made for a t2 route there.
	if err := f.owners.SetOwner(ctx, &models.Ownership{InstanceID: "i2", ResourceType: "routes", ResourceID: "r9", TeamID: "t2"}); err != nil {
		t.Fatal(err)
	}
	if err := f.idps.RecordClient(ctx, &models.IdPClient{
		IdPID: f.idpID, InstanceID: "i2", Prefix: "mad-", ClientID: "mad-c5", KeycloakUUID: "c5", RouteID: "r9", RouteCreateTime: 100,
	}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/apisix/admin/routes/")
		f.mu.Lock()
		defer f.mu.Unlock()
		switch r.Method {
		case http.MethodGet:
			if !f.existing[id] {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"message":"Key not found"}`))
				return
			}
			_, _ = w.Write([]byte(`{"key":"/apisix/routes/` + id + `","value":{"id":"` + id + `"}}`))
		case http.MethodPost:
			f.forwarded = append(f.forwarded, "POST")
			f.existing["q1"] = true
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"key":"/apisix/routes/q1","value":{"id":"q1"}}`))
		default:
			f.forwarded = append(f.forwarded, r.Method+" "+id)
			f.existing[id] = true
			_, _ = w.Write([]byte(`{"key":"/apisix/routes/` + id + `","value":{"id":"` + id + `"}}`))
		}
	}))
	t.Cleanup(srv.Close)
	f.h = NewProxyHandler(nil, f.owners, f.idps)
	f.h.getInstance = func(_ context.Context, id string) (*models.Instance, error) {
		return &models.Instance{ID: id, AdminAPIURL: srv.URL, AdminKey: "k", IsActive: true}, nil
	}
	return f
}

func (f *oidcProxyFixture) client(t *testing.T, uuid, route string, created int64) {
	t.Helper()
	e := &models.IdPClient{
		IdPID: f.idpID, InstanceID: "i1", Realm: "r", Prefix: "mad-", ClientID: "mad-" + uuid,
		KeycloakUUID: uuid, RouteID: route, Mode: "token", RouteCreateTime: created,
	}
	if err := f.idps.RecordClient(context.Background(), e); err != nil {
		t.Fatal(err)
	}
}

type proxyCaller struct {
	role string
	ui   *models.UserInstance
	team string
}

var devT1T2 = proxyCaller{
	role: models.RoleDeveloper,
	ui:   &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{"t1", "t2"}},
}

func (f *oidcProxyFixture) send(t *testing.T, who proxyCaller, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/v1/apisix/admin"+path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if who.team != "" {
		c.Request.Header.Set("X-Team-ID", who.team)
	}
	c.Params = gin.Params{{Key: "path", Value: path}}
	c.Set(middleware.InstanceIDKey, "i1")
	c.Set(middleware.RoleKey, who.role)
	if who.ui != nil {
		c.Set(middleware.UserInstanceKey, who.ui)
	}
	f.h.ProxyRequest(c)
	return w
}

func withClient(clientID string) string {
	return `{"uri":"/x/*","plugins":{"openid-connect":{"client_id":"` + clientID +
		`","client_secret":"s","discovery":"https://sso.test/realms/r/.well-known/openid-configuration"}}}`
}

// A route write carries the client it names into the route: the secret of a
// client the dashboard made for another team must not land in it, whichever
// way it was read (#464).
func TestProxyRefusesAnotherTeamsOIDCClient(t *testing.T) {
	acting := func(team string) proxyCaller { c := devT1T2; c.team = team; return c }
	admin := proxyCaller{role: models.RoleSuperAdmin, team: "t2"}
	cases := []struct {
		name         string
		who          proxyCaller
		method, path string
		body         string
		status       int
	}{
		{"t1 route, t2 client, acting t2", acting("t2"), http.MethodPut, "/routes/r1", withClient("mad-c2"), 403},
		{"t1 route, t1 client, acting t2", acting("t2"), http.MethodPut, "/routes/r1", withClient("mad-c1"), 200},
		{"t1 route, a client id typed by hand", acting("t2"), http.MethodPut, "/routes/r1", withClient("someone-else"), 200},
		{"t1 route, detached client", acting("t1"), http.MethodPut, "/routes/r1", withClient("mad-c3"), 403},
		{"t1 route, t2 client of another instance", acting("t2"), http.MethodPut, "/routes/r1", withClient("mad-c5"), 403},
		{"t2 route, t2 client of another instance", acting("t2"), http.MethodPut, "/routes/r2", withClient("mad-c5"), 200},
		{"t1 route, no plugin", acting("t2"), http.MethodPut, "/routes/r1", `{"uri":"/x/*"}`, 200},
		{"new route by PUT, acting t1, t2 client", acting("t1"), http.MethodPut, "/routes/n1", withClient("mad-c2"), 403},
		{"new route by PUT, acting t1, t1 client", acting("t1"), http.MethodPut, "/routes/n1", withClient("mad-c1"), 200},
		{"new route by POST, acting t1, t2 client", acting("t1"), http.MethodPost, "/routes", withClient("mad-c2"), 403},
		{"new route by POST, acting t1, t1 client", acting("t1"), http.MethodPost, "/routes", withClient("mad-c1"), 201},
		{"collection PUT naming r1, t2 client", acting("t2"), http.MethodPut, "/routes", `{"id":"r1","uri":"/x/*","plugins":{"openid-connect":{"client_id":"mad-c2"}}}`, 403},
		{"admin, t1 route, t2 client", admin, http.MethodPut, "/routes/r1", withClient("mad-c2"), 200},
	}
	for _, tc := range cases {
		f := newOIDCProxyFixture(t)
		w := f.send(t, tc.who, tc.method, tc.path, tc.body)
		if w.Code != tc.status {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
		}
		if tc.status == 403 {
			if len(f.forwarded) != 0 {
				t.Errorf("%s: the write reached the gateway: %v", tc.name, f.forwarded)
			}
			if strings.Contains(w.Body.String(), "mad-") {
				t.Errorf("%s: the refusal names a client: %s", tc.name, w.Body)
			}
		}
	}
}

// The quick page's chain: the route is created without the plugin, then the
// client made for it is written into it by PUT.
func TestProxyQuickRouteChainKeepsItsClient(t *testing.T) {
	f := newOIDCProxyFixture(t)
	who := devT1T2
	who.team = "t2"
	if w := f.send(t, who, http.MethodPost, "/routes", `{"uri":"/q/*","status":0}`); w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	if owner, _ := f.owners.GetOwner(context.Background(), "i1", "routes", "q1"); owner != "t2" {
		t.Fatalf("q1 owner %q", owner)
	}
	f.client(t, "c4", "q1", 100)
	if w := f.send(t, who, http.MethodPut, "/routes/q1", withClient("mad-c4")); w.Code != http.StatusOK {
		t.Fatalf("enable: %d %s", w.Code, w.Body)
	}
}

func TestRouteOIDCClientID(t *testing.T) {
	cases := map[string]string{
		withClient("mad-c1"): "mad-c1",
		`{"uri":"/x"}`:       "",
		`{"plugins":{"openid-connect":{"client_id":7}}}`: "",
		`{"plugins":{"openid-connect":"x"}}`:             "",
		`{"plugins":[]}`:                                 "",
		``:                                               "",
	}
	for body, want := range cases {
		if got := routeOIDCClientID([]byte(body)); got != want {
			t.Errorf("%s: got %q want %q", body, got, want)
		}
	}
}
