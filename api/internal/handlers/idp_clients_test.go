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
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

func TestMayCreateClient(t *testing.T) {
	on := &models.IdentityProvider{DevelopersCanCreate: true}
	off := &models.IdentityProvider{}
	dev := teamScope{writable: []string{"t1"}, teams: []string{"t1"}}
	cases := []struct {
		name  string
		scope teamScope
		p     *models.IdentityProvider
		owner string
		want  bool
	}{
		{"admin any owner", teamScope{isAdmin: true}, off, "t9", true},
		{"admin unowned", teamScope{isAdmin: true}, off, "", true},
		{"developer setting off", dev, off, "t1", false},
		{"developer setting on own team", dev, on, "t1", true},
		{"developer other team", dev, on, "t2", false},
		{"developer unowned", dev, on, "", false},
		{"viewer", teamScope{teams: []string{"t1"}}, on, "t1", false},
	}
	for _, tc := range cases {
		if got := mayCreateClient(tc.scope, tc.p, tc.owner); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestValidClientIDSuffix(t *testing.T) {
	for _, s := range []string{"billing", "bill.v2_x-1", "a", strings.Repeat("a", 64)} {
		if !validClientIDSuffix(s) {
			t.Errorf("%q refused", s)
		}
	}
	for _, s := range []string{"", "-x", "a/b", ".x", "a b", strings.Repeat("a", 65)} {
		if validClientIDSuffix(s) {
			t.Errorf("%q accepted", s)
		}
	}
}

func TestValidRedirectURI(t *testing.T) {
	cases := []struct {
		uri   string
		hosts []string
		ok    bool
	}{
		{"https://app.example.com/cb", []string{"app.example.com"}, true},
		{"https://APP.example.com/cb", []string{"app.example.com"}, true},
		{"https://app.example.com:8443/cb", []string{"app.example.com"}, true},
		{"http://anything.test/cb", nil, true},
		{"https://*.example.com/cb", nil, false},
		{"https://h/x*", nil, false},
		{"https://h/x#frag", nil, false},
		{"https://u:p@h/x", nil, false},
		{"https://u@h/x", nil, false},
		{"ftp://h/x", nil, false},
		{"https:///x", nil, false},
		{"/x", nil, false},
		{"", nil, false},
		{"https://evil.test/cb", []string{"app.example.com"}, false},
		// A wildcard route host matches one more label, as APISIX does.
		{"https://a.example.com/cb", []string{"*.example.com"}, true},
		{"https://A.Example.COM/cb", []string{"*.EXAMPLE.com"}, true},
		{"https://a.example.com:8443/cb", []string{"*.example.com"}, true},
		{"https://example.com/cb", []string{"*.example.com"}, false},
		{"https://a.b.example.com/cb", []string{"*.example.com"}, false},
		{"https://aexample.com/cb", []string{"*.example.com"}, false},
		{"https://a.example.org/cb", []string{"*.example.com"}, false},
		{"https://.example.com/cb", []string{"*.example.com"}, false},
		{"https://a.example.com/cb", []string{"*"}, false},
		{"https://x.app.test/cb", []string{"other.test", "*.app.test"}, true},
	}
	for _, tc := range cases {
		err := validRedirectURI(tc.uri, tc.hosts)
		if (err == nil) != tc.ok {
			t.Errorf("%q hosts %v: err = %v, want ok=%v", tc.uri, tc.hosts, err, tc.ok)
		}
	}
}

func TestValidateCreateRequest(t *testing.T) {
	login := models.IdPClientOptions{PKCE: true}
	cases := []struct {
		name string
		r    createClientRequest
		ok   bool
	}{
		{"login ok", createClientRequest{Mode: "login", ClientID: "a", RedirectURI: "https://h/cb", Options: login}, true},
		{"login no uri", createClientRequest{Mode: "login", ClientID: "a"}, false},
		{"login bad uri", createClientRequest{Mode: "login", ClientID: "a", RedirectURI: "/cb"}, false},
		{"token introspection", createClientRequest{Mode: "token", ClientID: "a", Options: models.IdPClientOptions{Validation: "introspection"}}, true},
		{"token jwks", createClientRequest{Mode: "token", ClientID: "a", Options: models.IdPClientOptions{Validation: "jwks"}}, true},
		{"token no validation", createClientRequest{Mode: "token", ClientID: "a"}, false},
		{"token bad validation", createClientRequest{Mode: "token", ClientID: "a", Options: models.IdPClientOptions{Validation: "x"}}, false},
		{"token redirect_uri", createClientRequest{Mode: "token", ClientID: "a", RedirectURI: "https://h/cb", Options: models.IdPClientOptions{Validation: "jwks"}}, false},
		{"bad mode", createClientRequest{Mode: "x", ClientID: "a"}, false},
		{"bad id", createClientRequest{Mode: "token", ClientID: "-a", Options: models.IdPClientOptions{Validation: "jwks"}}, false},
	}
	for _, tc := range cases {
		if err := validateCreateRequest(tc.r); (err == nil) != tc.ok {
			t.Errorf("%s: err = %v, want ok=%v", tc.name, err, tc.ok)
		}
	}
}

// memStore is an in-memory kvStore; PutJSON fails for registry keys when
// failClients is set, while the connection stays readable.
type memStore struct {
	mu          sync.Mutex
	data        map[string][]byte
	failClients bool
}

func (m *memStore) GetJSON(_ context.Context, key string, dest interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.data[key]
	if !ok {
		return nil // like EtcdClient.GetJSON: dest stays empty
	}
	return json.Unmarshal(b, dest)
}
func (m *memStore) PutJSON(_ context.Context, key string, v interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failClients && strings.HasPrefix(key, models.KeyPrefixIdPClients) {
		return errors.New("etcd down")
	}
	b, _ := json.Marshal(v)
	if m.data == nil {
		m.data = map[string][]byte{}
	}
	m.data[key] = b
	return nil
}
func (m *memStore) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, key)
	return nil
}
func (m *memStore) List(_ context.Context, prefix string) (map[string][]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string][]byte{}
	for k, v := range m.data {
		if strings.HasPrefix(k, prefix) {
			out[k] = v
		}
	}
	return out, nil
}

// fakeKC records the calls a handler makes to Keycloak.
type fakeKC struct {
	services.KeycloakAPI
	createErr error
	created   []services.ClientRepresentation
	deleted   []string
	secret    string
	secretErr error
	deleteErr error
	calls     int
	getRep    map[string]*services.ClientRepresentation
	getErr    map[string]error
}

func (f *fakeKC) GetClient(_ context.Context, id string) (*services.ClientRepresentation, error) {
	f.calls++
	if err := f.getErr[id]; err != nil {
		return nil, err
	}
	return f.getRep[id], nil
}

func (f *fakeKC) CreateClient(_ context.Context, rep services.ClientRepresentation) (string, error) {
	f.calls++
	if f.createErr != nil {
		return "", f.createErr
	}
	f.created = append(f.created, rep)
	return "uuid-1", nil
}
func (f *fakeKC) ClientSecret(context.Context, string) (string, error) {
	f.calls++
	return f.secret, f.secretErr
}
func (f *fakeKC) DeleteClient(_ context.Context, id string) error {
	f.calls++
	f.deleted = append(f.deleted, id)
	return f.deleteErr
}

type createFixture struct {
	h      *IdPHandler
	kc     *fakeKC
	store  *memStore
	inst   *models.Instance
	owners map[string]string
	hosts  map[string][]string // routes that exist, by id
	times  map[string]int64    // create_time of each route that exists; 100 unless set
	role   string
	ui     *models.UserInstance
	team   string // X-Team-ID of the request, if any
}

func newCreateFixture(t *testing.T, hosts []string, found bool) *createFixture {
	t.Helper()
	store := &memStore{}
	idps := services.NewIdPService(store)
	p := &models.IdentityProvider{
		Name: "kc", Type: models.IdPTypeKeycloak, BaseURL: "https://sso.test", Realm: "r",
		AdminClientID: "adm", AdminClientSecret: "s3cr3t", ClientIDPrefix: "mad-",
		InstanceIDs: []string{"i1"}, DevelopersCanCreate: true,
		RedirectDomains: []string{"app.test"},
	}
	if err := idps.Create(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	f := &createFixture{
		store:  store,
		kc:     &fakeKC{secret: "cl-secret"},
		inst:   &models.Instance{ID: "i1", IsActive: true},
		owners: map[string]string{"r1": "t1", "other": "t2"},
		hosts:  map[string][]string{},
		times:  map[string]int64{},
		role:   models.RoleSuperAdmin,
	}
	if found {
		f.hosts["r1"] = hosts
	}
	f.hosts["other"] = []string{"app.test"}
	f.hosts["unowned"] = []string{"app.test"}
	f.h = &IdPHandler{
		idps:     idps,
		keycloak: func(*models.IdentityProvider) services.KeycloakAPI { return f.kc },
		readRoute: func(_ context.Context, _ *models.Instance, id string) (routeFacts, error) {
			h, ok := f.hosts[id]
			return routeFacts{Hosts: h, CreateTime: f.createTime(id), Found: ok}, nil
		},
		listRoutes: func(context.Context, *models.Instance) ([]map[string]any, error) {
			out := []map[string]any{}
			for id := range f.hosts {
				out = append(out, map[string]any{"id": id, "create_time": float64(f.createTime(id))})
			}
			return out, nil
		},
		routeOwner:  func(_ context.Context, _, id string) (string, error) { return f.owners[id], nil },
		getInstance: func(context.Context, string) (*models.Instance, error) { return f.inst, nil },
	}
	return f
}

func (f *createFixture) createTime(id string) int64 {
	if v, ok := f.times[id]; ok {
		return v
	}
	return 100
}

func (f *createFixture) asDeveloper() {
	f.role = models.RoleDeveloper
	f.ui = &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{"t1"}}
}

func (f *createFixture) idpID(t *testing.T) string {
	all, err := f.h.idps.List(context.Background())
	if err != nil || len(all) != 1 {
		t.Fatalf("list: %v %d", err, len(all))
	}
	return all[0].ID
}

func (f *createFixture) post(t *testing.T, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("X-Instance-ID", "i1")
	c.Params = gin.Params{{Key: "id", Value: f.idpID(t)}}
	c.Set(middleware.RoleKey, f.role)
	if f.ui != nil {
		c.Set(middleware.UserInstanceKey, f.ui)
	}
	f.h.CreateClient(c)
	return w
}

func loginFor(route string) string {
	return `{"route_id":"` + route + `","client_id":"billing","mode":"login","redirect_uri":"https://app.test/cb"}`
}

const loginBody = `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://app.test/cb","options":{"pkce":true}}`

func TestCreateClientSuccess(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	w := f.post(t, loginBody)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["client_id"] != "mad-billing" || out["client_secret"] != "cl-secret" {
		t.Fatalf("body %v", out)
	}
	if len(f.kc.created) != 1 || f.kc.created[0].ClientID != "mad-billing" {
		t.Fatalf("created %v", f.kc.created)
	}
	if strings.Contains(w.Body.String(), "s3cr3t") {
		t.Fatal("admin secret leaked")
	}
}

func TestCreateClientRefusesBadRedirectBeforeKeycloak(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	w := f.post(t, `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://evil.test/cb"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
	if len(f.kc.created) != 0 {
		t.Fatal("keycloak was called")
	}
}

func TestCreateClientRouteMissing(t *testing.T) {
	f := newCreateFixture(t, nil, false)
	if w := f.post(t, loginBody); w.Code != http.StatusNotFound {
		t.Fatalf("status %d", w.Code)
	}
}

func TestCreateClientConflict(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.kc.createErr = services.ErrKeycloakClientExists
	w := f.post(t, loginBody)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "already exists in Keycloak") {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
}

func TestCreateClientKeycloakDown(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.kc.createErr = services.ErrKeycloakUnavailable
	if w := f.post(t, loginBody); w.Code != http.StatusBadGateway {
		t.Fatalf("status %d", w.Code)
	}
}

func TestCreateClientRollsBackWhenRecordFails(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.store.failClients = true
	w := f.post(t, loginBody)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if len(f.kc.deleted) != 1 || f.kc.deleted[0] != "uuid-1" {
		t.Fatalf("deleted %v", f.kc.deleted)
	}
	if strings.Contains(w.Body.String(), "cl-secret") {
		t.Fatal("secret in failure response")
	}
}

func TestCreateClientUnlinkedInstance(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(loginBody))
	c.Request.Header.Set("X-Instance-ID", "other")
	c.Params = gin.Params{{Key: "id", Value: f.idpID(t)}}
	c.Set(middleware.RoleKey, models.RoleSuperAdmin)
	f.h.CreateClient(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d", w.Code)
	}
}

func TestCreateClientDeveloperScope(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(f *createFixture)
		route  string
		status int
	}{
		{"setting off", func(f *createFixture) { f.asDeveloper(); f.disableDevelopers(t) }, "r1", 403},
		{"other team's route", func(f *createFixture) { f.asDeveloper() }, "other", 403},
		{"unowned route", func(f *createFixture) { f.asDeveloper() }, "unowned", 403},
		{"missing route", func(f *createFixture) { f.asDeveloper() }, "nope", 403},
		{"own team's route", func(f *createFixture) { f.asDeveloper() }, "r1", 201},
	}
	var bodies []string
	for _, tc := range cases {
		f := newCreateFixture(t, []string{"app.test"}, true)
		tc.setup(f)
		w := f.post(t, loginFor(tc.route))
		if w.Code != tc.status {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
		}
		if tc.status == 403 {
			if f.kc.calls != 0 {
				t.Errorf("%s: keycloak got %d calls", tc.name, f.kc.calls)
			}
			bodies = append(bodies, w.Body.String())
		}
	}
	for _, b := range bodies {
		if b != bodies[0] {
			t.Errorf("403 bodies differ: %q vs %q", b, bodies[0])
		}
	}
}

func (f *createFixture) disableDevelopers(t *testing.T) {
	all, _ := f.h.idps.List(context.Background())
	off := false
	if _, err := f.h.idps.Update(context.Background(), all[0].ID, services.IdPUpdate{DevelopersCanCreate: &off}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateClientAdminMissingRoute404(t *testing.T) {
	f := newCreateFixture(t, nil, true)
	if w := f.post(t, loginFor("nope")); w.Code != http.StatusNotFound {
		t.Fatalf("status %d", w.Code)
	}
}

func TestCreateClientHostlessRoute(t *testing.T) {
	f := newCreateFixture(t, nil, true)
	f.asDeveloper()
	w := f.post(t, loginBody)
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "an admin must create a login client for a route with no host") {
		t.Fatalf("developer: %d %s", w.Code, w.Body)
	}
	if f.kc.calls != 0 {
		t.Fatal("keycloak called")
	}
	f = newCreateFixture(t, nil, true)
	if w := f.post(t, loginBody); w.Code != http.StatusCreated {
		t.Fatalf("admin: %d %s", w.Code, w.Body)
	}
}

func TestCreateClientInactiveInstance(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.inst = &models.Instance{ID: "i1", IsActive: false}
	if w := f.post(t, loginBody); w.Code != http.StatusNotFound || f.kc.calls != 0 {
		t.Fatalf("inactive: %d calls %d", w.Code, f.kc.calls)
	}
	f.inst = nil
	if w := f.post(t, loginBody); w.Code != http.StatusNotFound || f.kc.calls != 0 {
		t.Fatalf("nil: %d calls %d", w.Code, f.kc.calls)
	}
}

func TestCreateClientRollsBackWhenSecretFails(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.kc.secretErr = services.ErrKeycloakUnavailable
	w := f.post(t, loginBody)
	if w.Code != http.StatusBadGateway || len(f.kc.deleted) != 1 || f.kc.deleted[0] != "uuid-1" {
		t.Fatalf("status %d deleted %v", w.Code, f.kc.deleted)
	}
}

func TestCreateClientRollbackFailureNamesClient(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.store.failClients = true
	f.kc.deleteErr = errors.New("boom")
	w := f.post(t, loginBody)
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "could not be removed from Keycloak: mad-billing") {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), "it was removed") {
		t.Fatal("claimed removal")
	}
}

func TestCreateClientNormalisesOptions(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	w := f.post(t, `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://app.test/cb","options":{"pkce":true,"validation":"jwks","client_credentials":true}}`)
	var out clientCredentials
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 201 || out.Options != (models.IdPClientOptions{PKCE: true}) {
		t.Fatalf("login: %d %+v", w.Code, out.Options)
	}
	w = f.post(t, `{"route_id":"r1","client_id":"b2","mode":"token","options":{"pkce":true,"validation":"jwks"}}`)
	out = clientCredentials{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 201 || out.Options.PKCE {
		t.Fatalf("token: %d %+v", w.Code, out.Options)
	}
}

func TestMayUseClient(t *testing.T) {
	dev := teamScope{writable: []string{"t1"}, teams: []string{"t1"}, acting: "t1"}
	two := teamScope{writable: []string{"t1", "t2"}, teams: []string{"t1", "t2"}}
	actingT2 := two
	actingT2.acting, actingT2.chosen = "t2", "t2"
	cases := []struct {
		name  string
		scope teamScope
		team  string
		use   bool
		list  bool
	}{
		{"admin unowned", teamScope{isAdmin: true}, "", true, true},
		{"admin any team", teamScope{isAdmin: true}, "t9", true, true},
		{"developer own team", dev, "t1", true, true},
		{"developer other team", dev, "t2", false, false},
		{"developer unowned", dev, "", false, false},
		{"viewer own team", teamScope{teams: []string{"t1"}}, "t1", false, false},
		{"two teams acting t2, t2 client", actingT2, "t2", true, true},
		{"two teams acting t2, t1 client", actingT2, "t1", false, true},
		{"two teams none named", two, "t1", false, true},
	}
	for _, tc := range cases {
		if got := mayUseClient(tc.scope, tc.team); got != tc.use {
			t.Errorf("%s: use got %v want %v", tc.name, got, tc.use)
		}
		if got := mayListClient(tc.scope, tc.team); got != tc.list {
			t.Errorf("%s: list got %v want %v", tc.name, got, tc.list)
		}
	}
}

// A developer in several teams uses a client only for the team they act as:
// the secret lands in a route of that team, and every member of it reads it.
func TestUseClientActingTeam(t *testing.T) {
	twoTeams := func(f *createFixture) {
		f.role = models.RoleDeveloper
		f.ui = &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{"t1", "t2"}}
	}
	cases := []struct {
		name   string
		setup  func(f *createFixture)
		team   string // X-Team-ID
		uuid   string // u1 belongs to t1, u2 to t2
		status int
		code   string
	}{
		{"two teams acting t2, t1 client", twoTeams, "t2", "u1", 403, ""},
		{"two teams acting t1, t1 client", twoTeams, "t1", "u1", 200, ""},
		{"two teams acting t2, t2 client", twoTeams, "t2", "u2", 200, ""},
		{"two teams none named", twoTeams, "", "u1", 400, teamRequiredCode},
		{"two teams naming a foreign team", twoTeams, "t9", "u1", 403, ""},
		{"t1 developer, t2 viewer, acting t2", func(f *createFixture) {
			twoTeams(f)
			f.ui.TeamRoles = map[string]string{"t1": models.RoleDeveloper, "t2": models.RoleViewer}
		}, "t2", "u1", 403, teamReadOnlyCode},
		{"single team, own client", func(f *createFixture) { f.asDeveloper() }, "", "u1", 200, ""},
		{"single team, other client", func(f *createFixture) { f.asDeveloper() }, "", "u2", 403, ""},
		{"single team named, other client", func(f *createFixture) { f.asDeveloper() }, "t1", "u2", 403, ""},
		{"admin, t1 client acting t2", func(f *createFixture) {}, "t2", "u1", 200, ""},
		{"admin, no team named", func(f *createFixture) {}, "", "u2", 200, ""},
		{"instance admin, t1 client acting t2", func(f *createFixture) {
			f.role = models.RoleDeveloper
			f.ui = &models.UserInstance{Role: models.RoleInstanceAdmin}
		}, "t2", "u1", 200, ""},
	}
	for _, tc := range cases {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.seedClient(t, "u1", "r1", "login")
		f.seedClient(t, "u2", "other", "login")
		tc.setup(f)
		f.team = tc.team
		w := f.do(t, http.MethodPost, "", tc.uuid, f.h.UseClient)
		if w.Code != tc.status {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
		}
		if tc.code != "" && !strings.Contains(w.Body.String(), tc.code) {
			t.Errorf("%s: body %s lacks code %s", tc.name, w.Body, tc.code)
		}
		if tc.status != 200 && f.kc.calls != 0 {
			t.Errorf("%s: keycloak got %d calls", tc.name, f.kc.calls)
		}
	}
}

// seedClient registers a client the dashboard "created" for a route.
func (f *createFixture) seedClient(t *testing.T, uuid, route, mode string) {
	t.Helper()
	e := &models.IdPClient{
		IdPID: f.idpID(t), InstanceID: "i1", Realm: "r", Prefix: "mad-",
		ClientID: "mad-" + uuid, KeycloakUUID: uuid, RouteID: route, Mode: mode,
		Options: models.IdPClientOptions{Validation: "introspection"}, RouteCreateTime: 100,
	}
	if mode == "login" {
		e.Options = models.IdPClientOptions{PKCE: true}
		e.RedirectURI = "https://app.test/cb"
	}
	if err := f.h.idps.RecordClient(context.Background(), e); err != nil {
		t.Fatal(err)
	}
}

func (f *createFixture) do(t *testing.T, method, query, uuid string, h gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/?"+query, nil)
	c.Request.Header.Set("X-Instance-ID", "i1")
	if f.team != "" {
		c.Request.Header.Set("X-Team-ID", f.team)
	}
	c.Params = gin.Params{{Key: "id", Value: "i1"}, {Key: "uuid", Value: uuid}}
	c.Set(middleware.InstanceIDKey, "i1")
	c.Set(middleware.RoleKey, f.role)
	if f.ui != nil {
		c.Set(middleware.UserInstanceKey, f.ui)
	}
	h(c)
	return w
}

func TestUseClientMissingInKeycloakIs410(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.kc.secretErr = services.ErrKeycloakClientMissing
	w := f.do(t, http.MethodPost, "", "u1", f.h.UseClient)
	if w.Code != http.StatusGone || !strings.Contains(w.Body.String(), "no longer exists in Keycloak") {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
}

func TestUseClientAnswersCredentials(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "token")
	w := f.do(t, http.MethodPost, "", "u1", f.h.UseClient)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["client_secret"] != "cl-secret" || out["client_id"] != "mad-u1" || out["mode"] != "token" ||
		out["discovery"] == "" || out["introspection_endpoint"] == nil {
		t.Fatalf("body %v", out)
	}
	if strings.Contains(w.Body.String(), "s3cr3t") {
		t.Fatal("admin secret leaked")
	}
}

func TestUseClientKeycloakDown(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.kc.secretErr = services.ErrKeycloakUnavailable
	if w := f.do(t, http.MethodPost, "", "u1", f.h.UseClient); w.Code != http.StatusBadGateway {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
}

func TestUseClientScope(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(f *createFixture)
		uuid   string
		status int
	}{
		{"admin missing", func(f *createFixture) {}, "nope", 404},
		{"developer missing", func(f *createFixture) { f.asDeveloper() }, "nope", 403},
		{"developer other team", func(f *createFixture) { f.asDeveloper() }, "u2", 403},
		{"developer own team", func(f *createFixture) { f.asDeveloper() }, "u1", 200},
		{"developer unowned route", func(f *createFixture) { f.asDeveloper(); f.seedClient(t, "u3", "unowned", "login") }, "u3", 403},
		{"viewer", func(f *createFixture) {
			f.role = models.RoleViewer
			f.ui = &models.UserInstance{Role: models.RoleViewer, TeamIDs: []string{"t1"}}
		}, "u1", 403},
		{"connection deleted, admin", func(f *createFixture) { f.dropIdP(t) }, "u1", 404},
		{"connection deleted, developer", func(f *createFixture) { f.asDeveloper(); f.dropIdP(t) }, "u1", 403},
	}
	var forbidden []string
	for _, tc := range cases {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.seedClient(t, "u1", "r1", "login")
		f.seedClient(t, "u2", "other", "login")
		tc.setup(f)
		w := f.do(t, http.MethodPost, "", tc.uuid, f.h.UseClient)
		if w.Code != tc.status {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
		}
		if tc.status == 403 {
			if f.kc.calls != 0 {
				t.Errorf("%s: keycloak got %d calls", tc.name, f.kc.calls)
			}
			forbidden = append(forbidden, w.Body.String())
		}
	}
	for _, b := range forbidden {
		if b != forbidden[0] {
			t.Errorf("403 bodies differ: %q vs %q", b, forbidden[0])
		}
	}
}

func (f *createFixture) dropIdP(t *testing.T) {
	t.Helper()
	// Only the connection: its registry entries stay, as after a lost write.
	if err := f.store.Delete(context.Background(), models.KeyPrefixIdPs+f.idpID(t)); err != nil {
		t.Fatal(err)
	}
}

func TestUseClientOwnerLookupError500(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.h.routeOwner = func(context.Context, string, string) (string, error) { return "", errors.New("etcd down") }
	if w := f.do(t, http.MethodPost, "", "u1", f.h.UseClient); w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", w.Code)
	}
}

func TestListClients(t *testing.T) {
	setup := func(f *createFixture) {
		f.seedClient(t, "u1", "r1", "login")
		f.seedClient(t, "u2", "other", "token")
	}
	f := newCreateFixture(t, []string{"app.test"}, true)
	setup(f)
	w := f.do(t, http.MethodGet, "", "", f.h.ListClients)
	var items []map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &items) != nil || len(items) != 2 {
		t.Fatalf("admin: %d %s", w.Code, w.Body)
	}
	byUUID := map[string]map[string]any{}
	for _, it := range items {
		byUUID[it["uuid"].(string)] = it
	}
	u1 := byUUID["u1"]
	if u1["client_id"] != "mad-u1" || u1["idp_name"] != "kc" || u1["route_id"] != "r1" || u1["team_id"] != "t1" || u1["mode"] != "login" {
		t.Fatalf("item %v", u1)
	}
	if strings.Contains(w.Body.String(), "cl-secret") || strings.Contains(w.Body.String(), "s3cr3t") {
		t.Fatal("secret leaked")
	}
	// admin, status=1: statuses are covered by TestClientStatus,
	// TestClientStatusUnknownWhenKeycloakFails and the TestListClientsStatus* tests.
	if w := f.do(t, http.MethodGet, "status=1", "", f.h.ListClients); w.Code != 200 {
		t.Fatalf("admin status=1: %d", w.Code)
	}

	f = newCreateFixture(t, []string{"app.test"}, true)
	setup(f)
	f.asDeveloper()
	w = f.do(t, http.MethodGet, "", "", f.h.ListClients)
	items = nil
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &items) != nil || len(items) != 1 || items[0]["uuid"] != "u1" {
		t.Fatalf("developer: %d %s", w.Code, w.Body)
	}
	if w := f.do(t, http.MethodGet, "status=1", "", f.h.ListClients); w.Code != 403 {
		t.Fatalf("developer status=1: %d", w.Code)
	}

	f = newCreateFixture(t, []string{"app.test"}, true)
	setup(f)
	f.role = models.RoleViewer
	f.ui = &models.UserInstance{Role: models.RoleViewer, TeamIDs: []string{"t1"}}
	if w := f.do(t, http.MethodGet, "", "", f.h.ListClients); w.Code != 403 {
		t.Fatalf("viewer: %d", w.Code)
	}
}

func TestListClientsSkipsDeletedConnection(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.dropIdP(t)
	w := f.do(t, http.MethodGet, "", "", f.h.ListClients)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestManagedEntry(t *testing.T) {
	cases := []struct {
		name string
		e    models.IdPClient
		want bool
	}{
		{"prefixed", models.IdPClient{Prefix: "mad-", ClientID: "mad-x"}, true},
		{"without the prefix", models.IdPClient{Prefix: "mad-", ClientID: "admin-cli"}, false},
		{"empty prefix", models.IdPClient{Prefix: "", ClientID: "mad-x"}, false},
	}
	for _, tc := range cases {
		if got := managedEntry(&tc.e); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestUseAndListRefuseTamperedEntry(t *testing.T) {
	for _, role := range []string{models.RoleSuperAdmin, models.RoleDeveloper} {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.seedClient(t, "u1", "r1", "login")
		e, err := f.h.idps.FindClient(context.Background(), "i1", "u1")
		if err != nil {
			t.Fatal(err)
		}
		e.ClientID = "realm-management"
		if err := f.h.idps.RecordClient(context.Background(), e); err != nil {
			t.Fatal(err)
		}
		if role == models.RoleDeveloper {
			f.asDeveloper()
		}
		want := map[string]int{models.RoleSuperAdmin: 404, models.RoleDeveloper: 403}[role]
		if w := f.do(t, http.MethodPost, "", "u1", f.h.UseClient); w.Code != want || f.kc.calls != 0 {
			t.Errorf("%s: use %d, %d keycloak calls", role, w.Code, f.kc.calls)
		}
		if role == models.RoleSuperAdmin {
			if w := f.do(t, http.MethodGet, "", "", f.h.ListClients); strings.TrimSpace(w.Body.String()) != "[]" {
				t.Errorf("list offers it: %s", w.Body)
			}
		}
	}
}

func TestRedirectHostAllowed(t *testing.T) {
	cases := []struct {
		name    string
		host    string
		domains []string
		want    bool
	}{
		{"exact", "example.com", []string{"example.com"}, true},
		{"subdomain", "app.example.com", []string{"example.com"}, true},
		{"deep subdomain", "a.b.example.com", []string{"example.com"}, true},
		{"suffix without dot", "evilexample.com", []string{"example.com"}, false},
		{"parent of the domain", "com", []string{"example.com"}, false},
		{"uppercase host", "APP.Example.COM", []string{"example.com"}, true},
		{"trailing dot", "app.example.com.", []string{"example.com"}, true},
		{"second domain", "x.other.org", []string{"example.com", "other.org"}, true},
		{"empty list", "example.com", nil, false},
		{"empty host", "", []string{"example.com"}, false},
	}
	for _, tc := range cases {
		if got := redirectHostAllowed(tc.host, tc.domains); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func (f *createFixture) setDomains(t *testing.T, d []string) {
	t.Helper()
	if _, err := f.h.idps.Update(context.Background(), f.idpID(t), services.IdPUpdate{RedirectDomains: &d}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateClientDeveloperRedirectDomains(t *testing.T) {
	t.Run("inside the domains", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.asDeveloper()
		if w := f.post(t, loginBody); w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
	})
	t.Run("subdomain of a domain", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.setDomains(t, []string{"test"})
		f.asDeveloper()
		if w := f.post(t, loginBody); w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
	})
	t.Run("outside the domains", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.setDomains(t, []string{"corp.example"})
		f.asDeveloper()
		w := f.post(t, loginBody)
		if w.Code != http.StatusForbidden {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
		if f.kc.calls != 0 {
			t.Fatalf("keycloak got %d calls", f.kc.calls)
		}
	})
	t.Run("no domain set", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.setDomains(t, []string{})
		f.asDeveloper()
		w := f.post(t, loginBody)
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "developers cannot create login clients on this connection: no redirect domain is set") {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
		if f.kc.calls != 0 {
			t.Fatalf("keycloak got %d calls", f.kc.calls)
		}
	})
	t.Run("admin outside the domains", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.setDomains(t, []string{"corp.example"})
		if w := f.post(t, loginBody); w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
	})
	t.Run("IP host refused", func(t *testing.T) {
		for _, host := range []string{"127.0.0.1", "[::1]"} {
			f := newCreateFixture(t, []string{trimBrackets(host)}, true)
			f.setDomains(t, []string{"test"})
			f.asDeveloper()
			body := `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://` + host + `/cb"}`
			if w := f.post(t, body); w.Code != http.StatusForbidden || f.kc.calls != 0 {
				t.Errorf("%s: status %d, %d calls: %s", host, w.Code, f.kc.calls, w.Body)
			}
		}
	})
	t.Run("non-ASCII host refused", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app\u00e9.test"}, true)
		f.setDomains(t, []string{"test"})
		f.asDeveloper()
		body := `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://app\u00e9.test/cb"}`
		if w := f.post(t, body); w.Code != http.StatusForbidden || f.kc.calls != 0 {
			t.Fatalf("status %d, %d calls: %s", w.Code, f.kc.calls, w.Body)
		}
	})
	t.Run("token mode needs no domain", func(t *testing.T) {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.setDomains(t, []string{})
		f.asDeveloper()
		body := `{"route_id":"r1","client_id":"api","mode":"token","options":{"validation":"jwks"}}`
		if w := f.post(t, body); w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
	})
}

func TestCreateClientStoresRouteCreateTime(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.times["r1"] = 4242
	if w := f.post(t, loginBody); w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	e, err := f.h.idps.FindClient(context.Background(), "i1", "uuid-1")
	if err != nil || e.RouteCreateTime != 4242 {
		t.Fatalf("entry %+v err %v", e, err)
	}
}

func TestUseClientRefusesRecreatedRoute(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(f *createFixture)
		admin  bool
		status int
	}{
		{"re-created route, developer", func(f *createFixture) { f.times["r1"] = 200 }, false, 403},
		{"re-created route, admin", func(f *createFixture) { f.times["r1"] = 200 }, true, 200},
		{"route deleted, developer", func(f *createFixture) { delete(f.hosts, "r1") }, false, 403},
		{"route deleted, admin", func(f *createFixture) { delete(f.hosts, "r1") }, true, 200},
		{"same route, developer", func(f *createFixture) {}, false, 200},
		{"entry without a create_time, developer", func(f *createFixture) { f.zeroEntryTime(t) }, false, 403},
	}
	var bodies []string
	for _, tc := range cases {
		f := newCreateFixture(t, []string{"app.test"}, true)
		f.seedClient(t, "u1", "r1", "login")
		if !tc.admin {
			f.asDeveloper()
		}
		tc.setup(f)
		w := f.do(t, http.MethodPost, "", "u1", f.h.UseClient)
		if w.Code != tc.status {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
		}
		if tc.status == 403 {
			if f.kc.calls != 0 {
				t.Errorf("%s: keycloak got %d calls", tc.name, f.kc.calls)
			}
			bodies = append(bodies, w.Body.String())
		}
	}
	for _, b := range bodies {
		if b != bodies[0] {
			t.Errorf("403 bodies differ: %q vs %q", b, bodies[0])
		}
	}
}

func (f *createFixture) zeroEntryTime(t *testing.T) {
	t.Helper()
	e, err := f.h.idps.FindClient(context.Background(), "i1", "u1")
	if err != nil {
		t.Fatal(err)
	}
	e.RouteCreateTime = 0
	if err := f.h.idps.RecordClient(context.Background(), e); err != nil {
		t.Fatal(err)
	}
}

func TestListClientsHidesRecreatedRouteFromDeveloper(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.times["r1"] = 200
	f.asDeveloper()
	w := f.do(t, http.MethodGet, "", "", f.h.ListClients)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("developer: %d %s", w.Code, w.Body)
	}
	f.role, f.ui = models.RoleSuperAdmin, nil
	w = f.do(t, http.MethodGet, "", "", f.h.ListClients)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"uuid":"u1"`) {
		t.Fatalf("admin: %d %s", w.Code, w.Body)
	}
}

func TestListClientsDeveloperGatewayErrorIs502(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.asDeveloper()
	f.h.listRoutes = func(context.Context, *models.Instance) ([]map[string]any, error) {
		return nil, errors.New("down")
	}
	if w := f.do(t, http.MethodGet, "", "", f.h.ListClients); w.Code != http.StatusBadGateway {
		t.Fatalf("status %d", w.Code)
	}
}

func trimBrackets(h string) string { return strings.Trim(h, "[]") }

func TestRoutesUsingClients(t *testing.T) {
	oidc := func(id any, cid string) map[string]any {
		return map[string]any{"id": id, "plugins": map[string]any{"openid-connect": map[string]any{"client_id": cid}}}
	}
	got := routesUsingClients([]map[string]any{
		oidc("r1", "apisix-a"),
		oidc("r2", "apisix-a"),
		{"id": "r3", "plugins": map[string]any{"limit-count": map[string]any{}}},
		oidc("r4", "apisix-b"),
		{"id": "r5"},
	})
	if len(got) != 2 || strings.Join(got["apisix-a"], ",") != "r1,r2" || strings.Join(got["apisix-b"], ",") != "r4" {
		t.Fatalf("got %v", got)
	}
}

func TestClientStatus(t *testing.T) {
	login := &models.IdPClient{ClientID: "mad-a", Mode: "login", RedirectURI: "https://app.test/cb", Options: models.IdPClientOptions{PKCE: true}}
	want := func(e *models.IdPClient) *services.ClientRepresentation {
		r := services.BuildClientRepresentation(e.ClientID, e.Mode, e.Options, e.RedirectURI)
		return &r
	}
	mod := func(f func(r *services.ClientRepresentation)) *services.ClientRepresentation {
		r := want(login)
		f(r)
		return r
	}
	used := []string{"r1"}
	cases := []struct {
		name string
		kc   *services.ClientRepresentation
		err  error
		used []string
		want string
	}{
		{"missing", nil, services.ErrKeycloakClientMissing, used, statusMissing},
		{"missing wins over no route", nil, services.ErrKeycloakClientMissing, nil, statusMissing},
		{"unknown on timeout", nil, services.ErrKeycloakUnavailable, used, statusUnknown},
		{"no route", want(login), nil, nil, statusNoRoute},
		{"changed: direct grants", mod(func(r *services.ClientRepresentation) { r.DirectAccessGrantsEnabled = true }), nil, used, statusChanged},
		{"changed: redirect uris", mod(func(r *services.ClientRepresentation) { r.RedirectURIs = []string{"https://evil.test/*"} }), nil, used, statusChanged},
		{"changed: extra redirect uri", mod(func(r *services.ClientRepresentation) { r.RedirectURIs = append(r.RedirectURIs, "https://x.test/") }), nil, used, statusChanged},
		{"changed: disabled", mod(func(r *services.ClientRepresentation) { r.Enabled = false }), nil, used, statusChanged},
		{"changed: pkce dropped", mod(func(r *services.ClientRepresentation) { r.Attributes = nil }), nil, used, statusChanged},
		{"ok", want(login), nil, used, statusOK},
		{"ok: uris in another order", mod(func(r *services.ClientRepresentation) { r.RedirectURIs = []string{"https://app.test/cb"} }), nil, used, statusOK},
	}
	for _, tc := range cases {
		if got := clientStatus(login, tc.kc, tc.err, tc.used); got != tc.want {
			t.Errorf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}
	tok := &models.IdPClient{ClientID: "mad-t", Mode: "token", Options: models.IdPClientOptions{Validation: "jwks", ClientCredentials: true}}
	if got := clientStatus(tok, want(tok), nil, used); got != statusOK {
		t.Errorf("token ok: %s", got)
	}
}

func TestClientStatusUnknownWhenKeycloakFails(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.seedClient(t, "u2", "r1", "token")
	f.h.listRoutes = func(context.Context, *models.Instance) ([]map[string]any, error) {
		return []map[string]any{
			{"id": "r1", "plugins": map[string]any{"openid-connect": map[string]any{"client_id": "mad-u2"}}},
		}, nil
	}
	rep := services.BuildClientRepresentation("mad-u2", "token", models.IdPClientOptions{Validation: "introspection"}, "")
	f.kc.getRep = map[string]*services.ClientRepresentation{"u2": &rep}
	// Not ErrKeycloakUnavailable: that one stops the calls to the connection.
	f.kc.getErr = map[string]error{"u1": services.ErrKeycloakForbidden}
	w := f.do(t, http.MethodGet, "status=1", "", f.h.ListClients)
	var items []clientListItem
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &items) != nil || len(items) != 2 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	by := map[string]clientListItem{}
	for _, it := range items {
		by[it.UUID] = it
	}
	if by["u1"].Status != statusUnknown || by["u2"].Status != statusOK || strings.Join(by["u2"].Routes, ",") != "r1" {
		t.Fatalf("items %+v", by)
	}
}

func TestListClientsStatusRouteListFailureIs502(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.h.listRoutes = func(context.Context, *models.Instance) ([]map[string]any, error) {
		return nil, errors.New("down")
	}
	if w := f.do(t, http.MethodGet, "status=1", "", f.h.ListClients); w.Code != http.StatusBadGateway {
		t.Fatalf("status %d", w.Code)
	}
}

func TestDeleteClientRefusesDeveloper(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.asDeveloper()
	if w := f.do(t, http.MethodDelete, "", "u1", f.h.DeleteClient); w.Code != http.StatusForbidden {
		t.Fatalf("status %d", w.Code)
	}
	if len(f.kc.deleted) != 0 {
		t.Fatal("keycloak was called")
	}
}

func TestDeleteClient(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	if w := f.do(t, http.MethodDelete, "", "nope", f.h.DeleteClient); w.Code != http.StatusNotFound {
		t.Fatalf("unknown: %d", w.Code)
	}
	// Keycloak down: 502 and the entry stays.
	f.kc.deleteErr = services.ErrKeycloakUnavailable
	if w := f.do(t, http.MethodDelete, "", "u1", f.h.DeleteClient); w.Code != http.StatusBadGateway {
		t.Fatalf("down: %d", w.Code)
	}
	if _, err := f.h.idps.FindClient(context.Background(), "i1", "u1"); err != nil {
		t.Fatalf("entry gone after a failed delete: %v", err)
	}
	f.kc.deleteErr = nil
	if w := f.do(t, http.MethodDelete, "", "u1", f.h.DeleteClient); w.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", w.Code, w.Body)
	}
	if strings.Join(f.kc.deleted, ",") != "u1,u1" { // the failed try, then the one that worked
		t.Fatalf("deleted %v", f.kc.deleted)
	}
	if _, err := f.h.idps.FindClient(context.Background(), "i1", "u1"); !errors.Is(err, services.ErrIdPNotFound) {
		t.Fatalf("entry kept: %v", err)
	}
}

func TestDeleteClientNeverTouchesUnmanagedEntry(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	e := &models.IdPClient{IdPID: f.idpID(t), InstanceID: "i1", Prefix: "mad-", ClientID: "other-app", KeycloakUUID: "u9", RouteID: "r1", Mode: "token"}
	if err := f.h.idps.RecordClient(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	if w := f.do(t, http.MethodDelete, "", "u9", f.h.DeleteClient); w.Code != http.StatusNotFound || len(f.kc.deleted) != 0 {
		t.Fatalf("status %d deleted %v", w.Code, f.kc.deleted)
	}
}

func TestDeleteClientConnectionGone(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	f.seedClient(t, "u1", "r1", "login")
	f.dropIdP(t)
	if w := f.do(t, http.MethodDelete, "", "u1", f.h.DeleteClient); w.Code != http.StatusNoContent {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if len(f.kc.deleted) != 0 {
		t.Fatal("keycloak was called without a connection")
	}
}

// statusItems runs the status list and reads its rows by uuid.
func statusItems(t *testing.T, f *createFixture) map[string]clientListItem {
	t.Helper()
	w := f.do(t, http.MethodGet, "status=1", "", f.h.ListClients)
	var items []clientListItem
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &items) != nil {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	by := map[string]clientListItem{}
	for _, it := range items {
		by[it.UUID] = it
	}
	return by
}

func TestListClientsStatusStopsCallingAnUnreachableKeycloak(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	for _, u := range []string{"u1", "u2", "u3"} {
		f.seedClient(t, u, "r1", "token")
	}
	f.kc.getErr = map[string]error{
		"u1": services.ErrKeycloakUnavailable, "u2": services.ErrKeycloakUnavailable, "u3": services.ErrKeycloakUnavailable,
	}
	by := statusItems(t, f)
	if len(by) != 3 {
		t.Fatalf("items %+v", by)
	}
	for u, it := range by {
		if it.Status != statusUnknown {
			t.Errorf("%s: status %q", u, it.Status)
		}
	}
	if f.kc.calls != 1 {
		t.Fatalf("an unreachable connection was called %d times", f.kc.calls)
	}
}

// slowKC answers every GetClient when its context ends, with that error.
type slowKC struct {
	services.KeycloakAPI
	calls int
}

func (s *slowKC) GetClient(ctx context.Context, _ string) (*services.ClientRepresentation, error) {
	s.calls++
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestListClientsStatusIsBoundedByOneDeadline(t *testing.T) {
	old := idpStatusTimeout
	idpStatusTimeout = 50 * time.Millisecond
	t.Cleanup(func() { idpStatusTimeout = old })

	f := newCreateFixture(t, []string{"app.test"}, true)
	for _, u := range []string{"u1", "u2", "u3"} {
		f.seedClient(t, u, "r1", "token")
	}
	slow := &slowKC{}
	f.h.keycloak = func(*models.IdentityProvider) services.KeycloakAPI { return slow }
	start := time.Now()
	by := statusItems(t, f)
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("took %v", elapsed)
	}
	if len(by) != 3 {
		t.Fatalf("items %+v", by)
	}
	for u, it := range by {
		if it.Status != statusUnknown {
			t.Errorf("%s: status %q", u, it.Status)
		}
	}
	if slow.calls != 1 {
		t.Fatalf("Keycloak was called %d times after the deadline", slow.calls)
	}
}

func TestCreateClientOnWildcardRouteHost(t *testing.T) {
	body := `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://x.app.test/cb"}`
	t.Run("admin", func(t *testing.T) {
		f := newCreateFixture(t, []string{"*.app.test"}, true)
		if w := f.post(t, body); w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
	})
	t.Run("admin, two labels below the wildcard", func(t *testing.T) {
		f := newCreateFixture(t, []string{"*.app.test"}, true)
		w := f.post(t, `{"route_id":"r1","client_id":"billing","mode":"login","redirect_uri":"https://a.x.app.test/cb"}`)
		if w.Code != http.StatusBadRequest || f.kc.calls != 0 {
			t.Fatalf("status %d, %d keycloak calls", w.Code, f.kc.calls)
		}
	})
	t.Run("developer inside the domains", func(t *testing.T) {
		f := newCreateFixture(t, []string{"*.app.test"}, true)
		f.asDeveloper()
		if w := f.post(t, body); w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
	})
	t.Run("developer outside the domains", func(t *testing.T) {
		f := newCreateFixture(t, []string{"*.app.test"}, true)
		f.setDomains(t, []string{"other.test"})
		f.asDeveloper()
		if w := f.post(t, body); w.Code != http.StatusForbidden || f.kc.calls != 0 {
			t.Fatalf("status %d, %d keycloak calls", w.Code, f.kc.calls)
		}
	})
}

// Create and use hand the route the address the gateways reach Keycloak at,
// when the connection has one; the backend's calls are not the route's concern.
func TestCreateAndUseWriteTheGatewayAddress(t *testing.T) {
	f := newCreateFixture(t, []string{"app.test"}, true)
	gw := "http://keycloak:8080"
	if _, err := f.h.idps.Update(context.Background(), f.idpID(t), services.IdPUpdate{GatewayBaseURL: &gw}); err != nil {
		t.Fatal(err)
	}
	const discovery = "http://keycloak:8080/realms/r/.well-known/openid-configuration"
	const introspection = "http://keycloak:8080/realms/r/protocol/openid-connect/token/introspect"

	w := f.post(t, `{"route_id":"r1","client_id":"orders","mode":"token","options":{"validation":"introspection"}}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: status %d: %s", w.Code, w.Body)
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["discovery"] != discovery || out["introspection_endpoint"] != introspection {
		t.Fatalf("create: body %v", out)
	}

	f.seedClient(t, "u1", "r1", "token")
	w = f.do(t, http.MethodPost, "", "u1", f.h.UseClient)
	if w.Code != http.StatusOK {
		t.Fatalf("use: status %d: %s", w.Code, w.Body)
	}
	out = map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["discovery"] != discovery || out["introspection_endpoint"] != introspection {
		t.Fatalf("use: body %v", out)
	}
}
