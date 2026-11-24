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
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
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
	stored    map[string]string // what the gateway holds, by "<type>/<id>"
	getFails  map[string]bool   // reads of these answer 500
	forwarded []string          // writes that reached the gateway
}

func newOIDCProxyFixture(t *testing.T) *oidcProxyFixture {
	t.Helper()
	f := &oidcProxyFixture{store: &memStore{}, getFails: map[string]bool{}, stored: map[string]string{
		"routes/r1": `{"id":"r1"}`, "routes/r2": `{"id":"r2"}`, "routes/boom": `{"id":"boom"}`,
		"services/s1": `{"id":"s1"}`, "services/s2": `{"id":"s2"}`,
		"consumer_groups/g1": `{"id":"g1"}`, "plugin_configs/pc1": `{"id":"pc1"}`,
		"consumers/u1": `{"username":"u1"}`,
	}}
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
	for key, team := range map[string]string{
		"routes/r1": "t1", "routes/r2": "t2", "routes/boom": "t1", "services/s1": "t1", "services/s2": "t2",
		"consumer_groups/g1": "t1", "plugin_configs/pc1": "t1", "consumers/u1": "t1",
	} {
		typ, id, _ := strings.Cut(key, "/")
		if err := f.owners.SetOwner(ctx, &models.Ownership{InstanceID: "i1", ResourceType: typ, ResourceID: id, TeamID: team}); err != nil {
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
		key := strings.TrimPrefix(r.URL.Path, "/apisix/admin/")
		typ, _, _ := strings.Cut(key, "/")
		f.mu.Lock()
		defer f.mu.Unlock()
		switch r.Method {
		case http.MethodGet:
			if f.getFails[key] {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			v, ok := f.stored[key]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"message":"Key not found"}`))
				return
			}
			_, _ = w.Write([]byte(`{"key":"/apisix/` + key + `","value":` + v + `}`))
		case http.MethodPost:
			f.forwarded = append(f.forwarded, "POST "+key)
			b, _ := io.ReadAll(r.Body)
			f.stored[typ+"/q1"] = string(b)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"key":"/apisix/` + typ + `/q1","value":{"id":"q1"}}`))
		default:
			f.forwarded = append(f.forwarded, r.Method+" "+key)
			b, _ := io.ReadAll(r.Body)
			id := strings.TrimPrefix(key, typ+"/")
			if id == "" || id == typ {
				var v struct {
					ID string `json:"id"`
				}
				_ = json.Unmarshal(b, &v)
				id = v.ID
			}
			f.stored[typ+"/"+id] = string(b)
			_, _ = w.Write([]byte(`{"key":"/apisix/` + typ + `/` + id + `","value":{"id":"` + id + `"}}`))
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

func TestPluginClientIDs(t *testing.T) {
	cases := map[string][]string{
		withClient("mad-c1"): {"mad-c1"},
		`{"uri":"/x"}`:       nil,
		`{"plugins":{"openid-connect":{"client_id":7}}}`: nil,
		`{"plugins":{"openid-connect":"x"}}`:             nil,
		`{"plugins":[]}`:                                 nil,
		``:                                               nil,
		`{"plugins":{"openid-connect":{"client_id":"a"},"authz-keycloak":{"client_id":"b"},"limit-count":{"count":1}}}`: {"a", "b"},
		`{"plugins":{"x":{"client_id":"a"},"y":{"client_id":"a"}}}`:                                                     {"a"},
	}
	for body, want := range cases {
		got := pluginClientIDs([]byte(body))
		slices.Sort(got)
		if !slices.Equal(got, want) {
			t.Errorf("%s: got %q want %q", body, got, want)
		}
	}
}

func TestChecksPluginClients(t *testing.T) {
	cases := []struct {
		method, typ, path string
		want              bool
	}{
		{http.MethodPut, "routes", "/routes/r1", true},
		{http.MethodPost, "routes", "/routes", true},
		{http.MethodPut, "services", "/services/s1", true},
		{http.MethodPost, "consumer_groups", "/consumer_groups", true},
		{http.MethodPut, "plugin_configs", "/plugin_configs/p", true},
		{http.MethodPatch, "routes", "/routes/r1", false},
		{http.MethodDelete, "routes", "/routes/r1", false},
		{http.MethodGet, "routes", "/routes/r1", false},
		{http.MethodPut, "upstreams", "/upstreams/u1", false},
		{http.MethodPut, "consumers", "/consumers/c", true},
		{http.MethodPut, "consumers", "/consumers/c/credentials/k", true},
		{http.MethodPost, "consumers", "/consumers/c/credentials", true},
		{http.MethodPut, "stream_routes", "/stream_routes/s", false},
	}
	for _, tc := range cases {
		if got := checksPluginClients(tc.method, tc.typ, tc.path); got != tc.want {
			t.Errorf("%s %s: got %v", tc.method, tc.path, got)
		}
	}
}

func pluginBody(plugin, clientID string) string {
	return `{"plugins":{"` + plugin + `":{"client_id":"` + clientID + `"}}}`
}

// The same rule for every type whose plugins reach a route's traffic, for
// any plugin's client_id, and only for a client newly attached (#464).
func TestProxyRefusesAnotherTeamsClientOnPluginTypes(t *testing.T) {
	acting := func(team string) proxyCaller { c := devT1T2; c.team = team; return c }
	admin := proxyCaller{role: models.RoleSuperAdmin, team: "t2"}
	detachedOnR1 := func(f *oidcProxyFixture) {
		f.stored["routes/r1"] = `{"id":"r1","plugins":{"openid-connect":{"client_id":"mad-c3"}}}`
	}
	none := func(*oidcProxyFixture) {}
	cases := []struct {
		name         string
		setup        func(f *oidcProxyFixture)
		who          proxyCaller
		method, path string
		body         string
		status       int
	}{
		{"t1 service, t2 client", none, acting("t2"), http.MethodPut, "/services/s1", withClient("mad-c2"), 403},
		{"t1 service, t1 client", none, acting("t2"), http.MethodPut, "/services/s1", withClient("mad-c1"), 200},
		{"new service by POST, acting t1, t2 client", none, acting("t1"), http.MethodPost, "/services", withClient("mad-c2"), 403},
		{"new service by POST, acting t1, t1 client", none, acting("t1"), http.MethodPost, "/services", withClient("mad-c1"), 201},
		{"t1 consumer group, t2 client", none, acting("t2"), http.MethodPut, "/consumer_groups/g1", pluginBody("openid-connect", "mad-c2"), 403},
		{"t1 consumer group, t1 client", none, acting("t2"), http.MethodPut, "/consumer_groups/g1", pluginBody("openid-connect", "mad-c1"), 200},
		{"t1 consumer, t2 client", none, acting("t2"), http.MethodPut, "/consumers/u1", `{"username":"u1","plugins":{"openid-connect":{"client_id":"mad-c2"}}}`, 403},
		{"t1 consumer, t1 client", none, acting("t2"), http.MethodPut, "/consumers/u1", `{"username":"u1","plugins":{"openid-connect":{"client_id":"mad-c1"}}}`, 200},
		{"t1 consumer's credential, t2 client", none, acting("t2"), http.MethodPut, "/consumers/u1/credentials/k1", pluginBody("openid-connect", "mad-c2"), 403},
		{"t1 consumer's credential, t1 client", none, acting("t2"), http.MethodPut, "/consumers/u1/credentials/k1", pluginBody("openid-connect", "mad-c1"), 200},
		{"t1 route, t2 client as authz-keycloak's audience", none, acting("t1"), http.MethodPut, "/routes/r1", `{"plugins":{"authz-keycloak":{"audience":"mad-c2"}}}`, 403},
		{"t1 route, t2 client in authz-keycloak", none, acting("t1"), http.MethodPut, "/routes/r1", pluginBody("authz-keycloak", "mad-c2"), 403},
		{"t1 route, t2 client in another plugin next to t1's", none, acting("t1"), http.MethodPut, "/routes/r1",
			`{"plugins":{"openid-connect":{"client_id":"mad-c1"},"authz-keycloak":{"client_id":"mad-c2"}}}`, 403},
		{"detached client kept on an edit", detachedOnR1, acting("t1"), http.MethodPut, "/routes/r1", withClient("mad-c3"), 200},
		{"detached client kept, t2 client added", detachedOnR1, acting("t1"), http.MethodPut, "/routes/r1",
			`{"plugins":{"openid-connect":{"client_id":"mad-c3"},"authz-keycloak":{"client_id":"mad-c2"}}}`, 403},
		{"detached client newly added", none, acting("t1"), http.MethodPut, "/routes/r1", withClient("mad-c3"), 403},
		{"stored resource unreadable", func(f *oidcProxyFixture) { f.getFails["routes/boom"] = true }, acting("t1"), http.MethodPut, "/routes/boom", withClient("mad-c1"), 502},
		{"service body not one object", none, acting("t1"), http.MethodPut, "/services/s1", `{"plugins":{}} {}`, 400},
		{"admin, t1 service, t2 client", none, admin, http.MethodPut, "/services/s1", withClient("mad-c2"), 200},
		{"admin, t1 plugin config, t2 client", none, admin, http.MethodPut, "/plugin_configs/pc1", pluginBody("openid-connect", "mad-c2"), 200},
	}
	for _, tc := range cases {
		f := newOIDCProxyFixture(t)
		tc.setup(f)
		w := f.send(t, tc.who, tc.method, tc.path, tc.body)
		if w.Code != tc.status {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
		}
		if tc.status >= 400 && len(f.forwarded) != 0 {
			t.Errorf("%s: the write reached the gateway: %v", tc.name, f.forwarded)
		}
	}
}
