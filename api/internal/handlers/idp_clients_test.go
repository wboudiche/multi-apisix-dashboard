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
		{"token pkce", createClientRequest{Mode: "token", ClientID: "a", Options: models.IdPClientOptions{Validation: "jwks", PKCE: true}}, false},
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
		return errors.New("not found")
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
}

func (f *fakeKC) CreateClient(_ context.Context, rep services.ClientRepresentation) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	f.created = append(f.created, rep)
	return "uuid-1", nil
}
func (f *fakeKC) ClientSecret(context.Context, string) (string, error) { return f.secret, nil }
func (f *fakeKC) DeleteClient(_ context.Context, id string) error {
	f.deleted = append(f.deleted, id)
	return nil
}

type createFixture struct {
	h     *IdPHandler
	kc    *fakeKC
	store *memStore
}

func newCreateFixture(t *testing.T, hosts []string, found bool) *createFixture {
	t.Helper()
	store := &memStore{}
	idps := services.NewIdPService(store)
	p := &models.IdentityProvider{
		Name: "kc", Type: models.IdPTypeKeycloak, BaseURL: "https://sso.test", Realm: "r",
		AdminClientID: "adm", AdminClientSecret: "s3cr3t", ClientIDPrefix: "mad-",
		InstanceIDs: []string{"i1"},
	}
	if err := idps.Create(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	kc := &fakeKC{secret: "cl-secret"}
	return &createFixture{
		store: store,
		kc:    kc,
		h: &IdPHandler{
			idps:           idps,
			keycloak:       func(*models.IdentityProvider) services.KeycloakAPI { return kc },
			readRouteHosts: func(context.Context, *models.Instance, string) ([]string, bool, error) { return hosts, found, nil },
			routeOwner:     func(context.Context, string, string) (string, error) { return "t1", nil },
			getInstance: func(_ context.Context, id string) (*models.Instance, error) {
				return &models.Instance{ID: id}, nil
			},
		},
	}
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
	c.Set(middleware.RoleKey, models.RoleSuperAdmin)
	f.h.CreateClient(c)
	return w
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
