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

package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

const kcSecret = "s3cret-admin-value"

func kcProvider(base string) *models.IdentityProvider {
	return &models.IdentityProvider{BaseURL: base, Realm: "gw", AdminClientID: "dash", AdminClientSecret: kcSecret}
}

func tokenOK(w http.ResponseWriter, r *http.Request) bool {
	if strings.HasSuffix(r.URL.Path, "/realms/gw/protocol/openid-connect/token") {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "client_credentials" || r.Form.Get("client_id") != "dash" || r.Form.Get("client_secret") != kcSecret {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
			return true
		}
		_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":300}`))
		return true
	}
	return false
}

func TestBuildClientRepresentation(t *testing.T) {
	r := BuildClientRepresentation("p-1", "login", models.IdPClientOptions{PKCE: true}, "https://gw/cb")
	if !r.StandardFlowEnabled || r.RedirectURIs[0] != "https://gw/cb" || r.Attributes["pkce.code.challenge.method"] != "S256" || r.Protocol != "openid-connect" {
		t.Fatalf("login+pkce: %+v", r)
	}
	r2 := BuildClientRepresentation("p-1", "login", models.IdPClientOptions{}, "https://gw/cb")
	if _, ok := r2.Attributes["pkce.code.challenge.method"]; ok {
		t.Fatalf("no pkce expected: %+v", r2)
	}
	r3 := BuildClientRepresentation("p-1", "token", models.IdPClientOptions{ClientCredentials: true}, "")
	if r3.StandardFlowEnabled || len(r3.RedirectURIs) != 0 || !r3.ServiceAccountsEnabled {
		t.Fatalf("token+cc: %+v", r3)
	}
	r4 := BuildClientRepresentation("p-1", "token", models.IdPClientOptions{}, "")
	if r4.ServiceAccountsEnabled {
		t.Fatalf("token: %+v", r4)
	}
	for _, x := range []ClientRepresentation{r, r2, r3, r4} {
		if x.PublicClient || x.ImplicitFlowEnabled || x.DirectAccessGrantsEnabled || x.ClientID != "p-1" {
			t.Fatalf("flags: %+v", x)
		}
	}
	b, _ := json.Marshal(r)
	if !strings.Contains(string(b), `"publicClient":false`) || !strings.Contains(string(b), `"enabled":true`) ||
		!strings.Contains(string(b), `"implicitFlowEnabled":false`) || !strings.Contains(string(b), `"directAccessGrantsEnabled":false`) || !strings.Contains(string(b), `"redirectUris"`) {
		t.Fatalf("json: %s", b)
	}
}

func TestCreateClientReturnsUUIDFromLocation(t *testing.T) {
	var got ClientRepresentation
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/admin/realms/gw/clients" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("bad request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.Header().Set("Location", "http://x/admin/realms/gw/clients/abc-123")
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL+"/"), srv.Client())
	id, err := c.CreateClient(context.Background(), ClientRepresentation{ClientID: "p-1"})
	if err != nil || id != "abc-123" || got.ClientID != "p-1" {
		t.Fatalf("id=%q err=%v got=%+v", id, err, got)
	}
}

func TestCreateClient409IsClientExists(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"errorMessage":"Client p-1 already exists"}`))
	}))
	defer srv.Close()
	_, err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).CreateClient(context.Background(), ClientRepresentation{ClientID: "p-1"})
	if !errors.Is(err, ErrKeycloakClientExists) {
		t.Fatalf("err=%v", err)
	}
}

func TestGetClient404IsMissing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client())
	if _, err := c.GetClient(context.Background(), "u"); !errors.Is(err, ErrKeycloakClientMissing) {
		t.Fatalf("get err=%v", err)
	}
	if _, err := c.ClientSecret(context.Background(), "u"); !errors.Is(err, ErrKeycloakClientMissing) {
		t.Fatalf("secret err=%v", err)
	}
}

func TestDeleteClient404IsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	if err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).DeleteClient(context.Background(), "u"); err != nil {
		t.Fatalf("err=%v", err)
	}
}

func TestClientSecretAndGetClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		switch r.URL.Path {
		case "/admin/realms/gw/clients/u1/client-secret":
			_, _ = w.Write([]byte(`{"type":"secret","value":"the-secret"}`))
		case "/admin/realms/gw/clients/u1":
			_, _ = w.Write([]byte(`{"id":"u1","clientId":"p-1"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client())
	if s, err := c.ClientSecret(context.Background(), "u1"); err != nil || s != "the-secret" {
		t.Fatalf("%q %v", s, err)
	}
	if rep, err := c.GetClient(context.Background(), "u1"); err != nil || rep.ClientID != "p-1" {
		t.Fatalf("%+v %v", rep, err)
	}
}

func TestKeycloakCachesToken(t *testing.T) {
	var tokens int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			atomic.AddInt32(&tokens, 1)
		}
		if tokenOK(w, r) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client())
	_ = c.DeleteClient(context.Background(), "a")
	_ = c.DeleteClient(context.Background(), "b")
	if n := atomic.LoadInt32(&tokens); n != 1 {
		t.Fatalf("token requests=%d", n)
	}
}

func TestKeycloakRefetchesTokenOn401(t *testing.T) {
	var tokens, calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			atomic.AddInt32(&tokens, 1)
		}
		if tokenOK(w, r) {
			return
		}
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	if err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).DeleteClient(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	if tk, cl := atomic.LoadInt32(&tokens), atomic.LoadInt32(&calls); tk != 2 || cl != 2 {
		t.Fatalf("tokens=%d calls=%d", tk, cl)
	}
}

func TestKeycloakBadAdminCredentials(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
	}))
	defer srv.Close()
	if err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).TestAccess(context.Background()); !errors.Is(err, ErrKeycloakAuth) {
		t.Fatalf("err=%v", err)
	}
}

func TestTestAccessForbidden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		if r.URL.Path != "/admin/realms/gw/clients" || r.URL.Query().Get("max") != "1" {
			t.Errorf("bad url %s", r.URL)
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	if err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).TestAccess(context.Background()); !errors.Is(err, ErrKeycloakForbidden) {
		t.Fatalf("err=%v", err)
	}
}

func TestTestAccessOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()
	if err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).TestAccess(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestKeycloakTimeout(t *testing.T) {
	old := keycloakRequestTimeout
	keycloakRequestTimeout = 50 * time.Millisecond
	defer func() { keycloakRequestTimeout = old }()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
	}))
	defer srv.Close()
	err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).TestAccess(context.Background())
	if !errors.Is(err, ErrKeycloakUnavailable) {
		t.Fatalf("err=%v", err)
	}
}

func TestKeycloakUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()
	if err := NewKeycloakClient(kcProvider(url), http.DefaultClient).TestAccess(context.Background()); !errors.Is(err, ErrKeycloakUnavailable) {
		t.Fatalf("err=%v", err)
	}
}

func TestKeycloakErrorsNeverCarrySecrets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`<html>echo ` + kcSecret + `</html>`))
	}))
	defer srv.Close()
	_, err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).CreateClient(context.Background(), ClientRepresentation{ClientID: "x"})
	if err == nil || strings.Contains(err.Error(), kcSecret) || !strings.Contains(err.Error(), "400") {
		t.Fatalf("err=%v", err)
	}
}

func TestKeycloakErrorCarriesReasonOnly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"errorMessage":"bad redirect","other":"` + kcSecret + `"}`))
	}))
	defer srv.Close()
	_, err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).CreateClient(context.Background(), ClientRepresentation{ClientID: "x"})
	if err == nil || !strings.Contains(err.Error(), "bad redirect") || strings.Contains(err.Error(), kcSecret) {
		t.Fatalf("err=%v", err)
	}
}

func TestDiscoveryAndIntrospectionURL(t *testing.T) {
	p := kcProvider("https://kc.example/")
	if DiscoveryURL(p) != "https://kc.example/realms/gw/.well-known/openid-configuration" {
		t.Fatal(DiscoveryURL(p))
	}
	if IntrospectionURL(p) != "https://kc.example/realms/gw/protocol/openid-connect/token/introspect" {
		t.Fatal(IntrospectionURL(p))
	}
}

func TestKeycloakDoesNotFollowRedirects(t *testing.T) {
	var hit int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hit, 1)
	}))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/steal", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).TestAccess(context.Background())
	if err == nil || atomic.LoadInt32(&hit) != 0 {
		t.Fatalf("err=%v hit=%d", err, hit)
	}
}

func TestKeycloakRefetchesTokenInsideExpiryMargin(t *testing.T) {
	var tokens int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			atomic.AddInt32(&tokens, 1)
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":60}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).(*keycloakClient)
	now := time.Now()
	c.now = func() time.Time { return now }
	_ = c.DeleteClient(context.Background(), "a")
	now = now.Add(29 * time.Second)
	_ = c.DeleteClient(context.Background(), "a")
	if n := atomic.LoadInt32(&tokens); n != 1 {
		t.Fatalf("tokens before margin=%d", n)
	}
	now = now.Add(2 * time.Second) // 31 s in: inside the 30 s margin
	_ = c.DeleteClient(context.Background(), "a")
	if n := atomic.LoadInt32(&tokens); n != 2 {
		t.Fatalf("tokens after margin=%d", n)
	}
}

func TestKeycloakSecond401IsAuthError(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tokenOK(w, r) {
			return
		}
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	err := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).DeleteClient(context.Background(), "a")
	if !errors.Is(err, ErrKeycloakAuth) || atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}

func TestRouteFacingURLsPreferTheGatewayAddress(t *testing.T) {
	p := &models.IdentityProvider{BaseURL: "https://sso.example.com/", Realm: "corp"}
	if got := DiscoveryURL(p); got != "https://sso.example.com/realms/corp/.well-known/openid-configuration" {
		t.Fatalf("discovery without gateway url: %s", got)
	}
	p.GatewayBaseURL = "http://keycloak:8080/"
	if got := DiscoveryURL(p); got != "http://keycloak:8080/realms/corp/.well-known/openid-configuration" {
		t.Fatalf("discovery: %s", got)
	}
	if got := IntrospectionURL(p); got != "http://keycloak:8080/realms/corp/protocol/openid-connect/token/introspect" {
		t.Fatalf("introspection: %s", got)
	}
	// The backend's own calls stay on the base URL.
	if got := keycloakBase(p); got != "https://sso.example.com/realms/corp" {
		t.Fatalf("backend base: %s", got)
	}
}

// Every created client puts its own id in the audience of its tokens, so a
// route can accept only the tokens issued for its client (claim_validator).
func TestBuildClientRepresentationAddsOwnAudience(t *testing.T) {
	for _, mode := range []string{"login", "token"} {
		r := BuildClientRepresentation("p-1", mode, models.IdPClientOptions{ClientCredentials: true}, "https://gw/cb")
		if len(r.ProtocolMappers) != 1 {
			t.Fatalf("%s: mappers %+v", mode, r.ProtocolMappers)
		}
		m := r.ProtocolMappers[0]
		if m.Protocol != "openid-connect" || m.ProtocolMapper != "oidc-audience-mapper" ||
			m.Config["included.client.audience"] != "p-1" || m.Config["access.token.claim"] != "true" ||
			m.Config["introspection.token.claim"] != "true" {
			t.Fatalf("%s: mapper %+v", mode, m)
		}
	}
}
