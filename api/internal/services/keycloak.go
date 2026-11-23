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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

var (
	ErrKeycloakAuth          = errors.New("keycloak rejected the admin client credentials")
	ErrKeycloakForbidden     = errors.New("keycloak admin client lacks permission to manage clients")
	ErrKeycloakClientExists  = errors.New("keycloak client id already exists")
	ErrKeycloakClientMissing = errors.New("keycloak client not found")
	ErrKeycloakUnavailable   = errors.New("keycloak is unreachable")
)

// keycloakRequestTimeout bounds each call to Keycloak (a package var so a test can shorten it).
var keycloakRequestTimeout = 10 * time.Second

// tokenExpirySkew is how long before expiry a cached token is dropped.
const tokenExpirySkew = 30 * time.Second

// ClientRepresentation is the subset of Keycloak's ClientRepresentation the dashboard uses.
type ClientRepresentation struct {
	ID                        string            `json:"id,omitempty"`
	ClientID                  string            `json:"clientId"`
	Enabled                   bool              `json:"enabled"`
	Protocol                  string            `json:"protocol"`
	PublicClient              bool              `json:"publicClient"`
	StandardFlowEnabled       bool              `json:"standardFlowEnabled"`
	ImplicitFlowEnabled       bool              `json:"implicitFlowEnabled"`
	DirectAccessGrantsEnabled bool              `json:"directAccessGrantsEnabled"`
	ServiceAccountsEnabled    bool              `json:"serviceAccountsEnabled"`
	RedirectURIs              []string          `json:"redirectUris"`
	Attributes                map[string]string `json:"attributes,omitempty"`
}

// BuildClientRepresentation turns a route mode and its options into the client Keycloak must create.
// Clients are always confidential, with the implicit and direct-grant flows off.
func BuildClientRepresentation(clientID, mode string, o models.IdPClientOptions, redirectURI string) ClientRepresentation {
	rep := ClientRepresentation{
		ClientID:     clientID,
		Enabled:      true,
		Protocol:     "openid-connect",
		RedirectURIs: []string{},
	}
	if mode == "login" {
		rep.StandardFlowEnabled = true
		rep.RedirectURIs = []string{redirectURI}
		if o.PKCE {
			rep.Attributes = map[string]string{"pkce.code.challenge.method": "S256"}
		}
		return rep
	}
	rep.ServiceAccountsEnabled = o.ClientCredentials
	return rep
}

// KeycloakAPI is what the handlers need from Keycloak's Admin REST API.
type KeycloakAPI interface {
	TestAccess(ctx context.Context) error
	CreateClient(ctx context.Context, rep ClientRepresentation) (uuid string, err error)
	ClientSecret(ctx context.Context, uuid string) (string, error)
	GetClient(ctx context.Context, uuid string) (*ClientRepresentation, error)
	DeleteClient(ctx context.Context, uuid string) error // 404 → nil
}

func keycloakBase(p *models.IdentityProvider) string {
	return strings.TrimRight(p.BaseURL, "/") + "/realms/" + url.PathEscape(p.Realm)
}

// gatewayBase is the realm as the gateways reach it: GatewayBaseURL when the
// connection has one, the backend's BaseURL otherwise.
func gatewayBase(p *models.IdentityProvider) string {
	root := p.GatewayBaseURL
	if root == "" {
		root = p.BaseURL
	}
	return strings.TrimRight(root, "/") + "/realms/" + url.PathEscape(p.Realm)
}

// DiscoveryURL is the realm's OpenID Connect discovery document, for a route.
func DiscoveryURL(p *models.IdentityProvider) string {
	return gatewayBase(p) + "/.well-known/openid-configuration"
}

// IntrospectionURL is the realm's token introspection endpoint, for a route.
func IntrospectionURL(p *models.IdentityProvider) string {
	return gatewayBase(p) + "/protocol/openid-connect/token/introspect"
}

// tokenFailureTTL is how long a failed token fetch is answered to every
// caller without asking Keycloak again, so a dead Keycloak is not hammered.
const tokenFailureTTL = 5 * time.Second

type keycloakClient struct {
	p    *models.IdentityProvider
	http *http.Client
	now  func() time.Time

	// mu guards the fields below and is never held across a network call.
	mu        sync.Mutex
	token     string
	expiry    time.Time
	failErr   error
	failUntil time.Time
	inflight  *tokenFetch
}

// tokenFetch is one token request every concurrent caller waits on; done is
// closed once token and err are set.
type tokenFetch struct {
	done  chan struct{}
	token string
	err   error
}

// NewKeycloakClient returns a client for the provider's realm. A nil httpClient uses http.DefaultClient.
func NewKeycloakClient(p *models.IdentityProvider, httpClient *http.Client) KeycloakAPI {
	// Never follow redirects: the token POST carries the client secret and Go
	// resends a POST body on 307/308. A 3xx comes back as an unexpected status.
	hc := http.Client{}
	if httpClient != nil {
		hc = *httpClient
	}
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &keycloakClient{p: p, http: &hc, now: time.Now}
}

// keycloakReason reads Keycloak's error/errorMessage fields from a body and nothing else.
func keycloakReason(body []byte) string {
	var e struct {
		Error        string `json:"error"`
		ErrorMessage string `json:"errorMessage"`
	}
	if json.Unmarshal(body, &e) != nil {
		return ""
	}
	if e.ErrorMessage != "" {
		return e.ErrorMessage
	}
	return e.Error
}

func keycloakStatusError(op string, status int, body []byte) error {
	if reason := keycloakReason(body); reason != "" {
		return fmt.Errorf("keycloak %s: status %d: %s", op, status, reason)
	}
	return fmt.Errorf("keycloak %s: status %d", op, status)
}

// do sends one request with the request timeout and returns status, headers and body.
func (c *keycloakClient) do(ctx context.Context, method, target string, body []byte, contentType, bearer string) (int, http.Header, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, keycloakRequestTimeout)
	defer cancel()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, rd)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("%w: invalid request", ErrKeycloakUnavailable)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		// url.Error carries the URL only, never credentials (they travel in the body).
		return 0, nil, nil, fmt.Errorf("%w: %v", ErrKeycloakUnavailable, errors.Unwrap(err))
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, nil, fmt.Errorf("%w: reading response", ErrKeycloakUnavailable)
	}
	return resp.StatusCode, resp.Header, b, nil
}

func (c *keycloakClient) fetchToken(ctx context.Context) (string, time.Time, error) {
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.p.AdminClientID},
		"client_secret": {c.p.AdminClientSecret},
	}
	status, _, body, err := c.do(ctx, http.MethodPost, keycloakBase(c.p)+"/protocol/openid-connect/token",
		[]byte(form.Encode()), "application/x-www-form-urlencoded", "")
	if err != nil {
		return "", time.Time{}, err
	}
	if status == http.StatusUnauthorized || (status == http.StatusBadRequest && keycloakReason(body) == "invalid_client") {
		return "", time.Time{}, ErrKeycloakAuth
	}
	if status != http.StatusOK {
		return "", time.Time{}, keycloakStatusError("token", status, body)
	}
	var t struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if json.Unmarshal(body, &t) != nil || t.AccessToken == "" {
		return "", time.Time{}, errors.New("keycloak token: unreadable response")
	}
	return t.AccessToken, c.now().Add(time.Duration(t.ExpiresIn)*time.Second - tokenExpirySkew), nil
}

// bearer returns a token for the Admin API. rejected is a token Keycloak just
// answered 401 to, or "": it is dropped only if it is still the cached one,
// so a token another caller already replaced is used, not refetched.
//
// Concurrent callers share one fetch, and its failure for tokenFailureTTL.
// The fetch runs on its own context, bounded by keycloakRequestTimeout, so a
// caller that gives up does not cancel it for the others; each waiter stops
// waiting when its own context ends.
func (c *keycloakClient) bearer(ctx context.Context, rejected string) (string, error) {
	c.mu.Lock()
	if rejected != "" && c.token == rejected {
		c.token = ""
	}
	if c.token != "" && c.now().Before(c.expiry) {
		tok := c.token
		c.mu.Unlock()
		return tok, nil
	}
	if c.failErr != nil && c.now().Before(c.failUntil) {
		err := c.failErr
		c.mu.Unlock()
		return "", err
	}
	f := c.inflight
	if f == nil {
		f = &tokenFetch{done: make(chan struct{})}
		c.inflight = f
		go c.runFetch(context.WithoutCancel(ctx), f)
	}
	c.mu.Unlock()

	select {
	case <-f.done:
		return f.token, f.err
	case <-ctx.Done():
		return "", fmt.Errorf("%w: %v", ErrKeycloakUnavailable, ctx.Err())
	}
}

func (c *keycloakClient) runFetch(ctx context.Context, f *tokenFetch) {
	tok, expiry, err := c.fetchToken(ctx)
	c.mu.Lock()
	if err != nil {
		c.token = ""
		c.failErr, c.failUntil = err, c.now().Add(tokenFailureTTL)
	} else {
		c.token, c.expiry = tok, expiry
		c.failErr = nil
	}
	c.inflight = nil
	f.token, f.err = tok, err
	c.mu.Unlock()
	close(f.done)
}

// admin calls the Admin API; a 401 refetches the token once and retries.
func (c *keycloakClient) admin(ctx context.Context, method, path string, body []byte) (int, http.Header, []byte, error) {
	target := strings.TrimRight(c.p.BaseURL, "/") + "/admin/realms/" + url.PathEscape(c.p.Realm) + path
	ct := ""
	if body != nil {
		ct = "application/json"
	}
	rejected := ""
	for attempt := 0; ; attempt++ {
		tok, err := c.bearer(ctx, rejected)
		if err != nil {
			return 0, nil, nil, err
		}
		rejected = tok
		status, h, b, err := c.do(ctx, method, target, body, ct, tok)
		if err != nil {
			return 0, nil, nil, err
		}
		if status == http.StatusUnauthorized && attempt == 0 {
			continue
		}
		if status == http.StatusUnauthorized {
			return 0, nil, nil, ErrKeycloakAuth
		}
		return status, h, b, nil
	}
}

func (c *keycloakClient) TestAccess(ctx context.Context) error {
	status, _, body, err := c.admin(ctx, http.MethodGet, "/clients?max=1", nil)
	if err != nil {
		return err
	}
	switch status {
	case http.StatusOK:
		return nil
	case http.StatusForbidden:
		return ErrKeycloakForbidden
	}
	return keycloakStatusError("test access", status, body)
}

func (c *keycloakClient) CreateClient(ctx context.Context, rep ClientRepresentation) (string, error) {
	payload, err := json.Marshal(rep)
	if err != nil {
		return "", err
	}
	status, h, body, err := c.admin(ctx, http.MethodPost, "/clients", payload)
	if err != nil {
		return "", err
	}
	switch status {
	case http.StatusCreated:
		loc := strings.TrimRight(h.Get("Location"), "/")
		id := loc[strings.LastIndex(loc, "/")+1:]
		if id == "" {
			return "", errors.New("keycloak create client: no Location header")
		}
		return id, nil
	case http.StatusConflict:
		return "", ErrKeycloakClientExists
	case http.StatusForbidden:
		return "", ErrKeycloakForbidden
	}
	return "", keycloakStatusError("create client", status, body)
}

func (c *keycloakClient) ClientSecret(ctx context.Context, id string) (string, error) {
	status, _, body, err := c.admin(ctx, http.MethodGet, "/clients/"+url.PathEscape(id)+"/client-secret", nil)
	if err != nil {
		return "", err
	}
	switch status {
	case http.StatusOK:
		var s struct {
			Value string `json:"value"`
		}
		if json.Unmarshal(body, &s) != nil {
			return "", errors.New("keycloak client secret: unreadable response")
		}
		return s.Value, nil
	case http.StatusNotFound:
		return "", ErrKeycloakClientMissing
	case http.StatusForbidden:
		return "", ErrKeycloakForbidden
	}
	return "", keycloakStatusError("read client secret", status, body)
}

func (c *keycloakClient) GetClient(ctx context.Context, id string) (*ClientRepresentation, error) {
	status, _, body, err := c.admin(ctx, http.MethodGet, "/clients/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	switch status {
	case http.StatusOK:
		var rep ClientRepresentation
		if json.Unmarshal(body, &rep) != nil {
			return nil, errors.New("keycloak get client: unreadable response")
		}
		return &rep, nil
	case http.StatusNotFound:
		return nil, ErrKeycloakClientMissing
	case http.StatusForbidden:
		return nil, ErrKeycloakForbidden
	}
	return nil, keycloakStatusError("get client", status, body)
}

func (c *keycloakClient) DeleteClient(ctx context.Context, id string) error {
	status, _, body, err := c.admin(ctx, http.MethodDelete, "/clients/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	switch status {
	case http.StatusNoContent, http.StatusOK, http.StatusNotFound:
		return nil
	case http.StatusForbidden:
		return ErrKeycloakForbidden
	}
	return keycloakStatusError("delete client", status, body)
}
