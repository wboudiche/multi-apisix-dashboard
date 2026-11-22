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
	"errors"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

// maxKeycloakMessage caps what of a Keycloak error reaches a user.
const maxKeycloakMessage = 200

var clientIDSuffixPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type createClientRequest struct {
	RouteID     string                  `json:"route_id"`
	ClientID    string                  `json:"client_id"` // suffix: the backend adds the prefix
	Mode        string                  `json:"mode"`
	RedirectURI string                  `json:"redirect_uri"`
	Options     models.IdPClientOptions `json:"options"`
}

// clientCredentials is what create and use answer. The secret is returned
// here and nowhere else, and is never logged.
type clientCredentials struct {
	ClientID              string                  `json:"client_id"`
	ClientSecret          string                  `json:"client_secret"`
	Discovery             string                  `json:"discovery"`
	IntrospectionEndpoint string                  `json:"introspection_endpoint,omitempty"`
	Mode                  string                  `json:"mode"`
	Options               models.IdPClientOptions `json:"options"`
	RedirectURI           string                  `json:"redirect_uri,omitempty"`
}

// mayCreateClient: an admin always; a developer when the connection allows
// developers and the route belongs to a team they write to.
func mayCreateClient(scope teamScope, p *models.IdentityProvider, routeOwner string) bool {
	if scope.isAdmin {
		return true
	}
	return p.DevelopersCanCreate && scope.mayWrite(routeOwner)
}

func validClientIDSuffix(s string) bool { return clientIDSuffixPattern.MatchString(s) }

// validRedirectURI refuses a redirect URI Keycloak would honour too widely or
// that points away from the route: absolute http(s) with a host, no wildcard,
// fragment or userinfo, and, when the route matches hosts, one of them.
func validRedirectURI(uri string, routeHosts []string) error {
	bad := errors.New("redirect_uri must be an absolute http(s) URL without wildcard, fragment or credentials")
	if strings.Contains(uri, "*") || strings.Contains(uri, "#") {
		return bad
	}
	u, err := url.Parse(uri)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return bad
	}
	if len(routeHosts) == 0 {
		return nil
	}
	for _, h := range routeHosts {
		if strings.EqualFold(h, u.Hostname()) {
			return nil
		}
	}
	return errors.New("redirect_uri host must be one of the route's hosts")
}

// validateCreateRequest checks the shape of a request, nothing that needs the
// route or the gateway.
func validateCreateRequest(r createClientRequest) error {
	if !validClientIDSuffix(r.ClientID) {
		return errors.New("client_id must be 1-64 letters, digits, '.', '_' or '-', starting with a letter or digit")
	}
	switch r.Mode {
	case "login":
		return validRedirectURI(r.RedirectURI, nil)
	case "token":
		if v := r.Options.Validation; v != "introspection" && v != "jwks" {
			return errors.New("validation must be introspection or jwks in token mode")
		}
		if r.RedirectURI != "" {
			return errors.New("redirect_uri applies to login mode only")
		}
		return nil
	}
	return errors.New("mode must be login or token")
}

// normalizedOptions keeps, per mode, only the options that mean something
// there: login has PKCE; token has its validation and client credentials.
func normalizedOptions(r createClientRequest) models.IdPClientOptions {
	if r.Mode == "login" {
		return models.IdPClientOptions{PKCE: r.Options.PKCE}
	}
	return models.IdPClientOptions{Validation: r.Options.Validation, ClientCredentials: r.Options.ClientCredentials}
}

func capKeycloakMessage(err error) string {
	r := []rune(err.Error())
	if len(r) > maxKeycloakMessage {
		r = r[:maxKeycloakMessage]
	}
	return string(r)
}

// rollbackClient removes a client Keycloak just created, on a context that
// outlives the request. It reports whether the client is gone.
func rollbackClient(ctx context.Context, kc services.KeycloakAPI, kcID, uuid string) bool {
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := kc.DeleteClient(rctx, uuid); err != nil {
		log.Printf("[idp] could not remove keycloak client %s (uuid %s) after a failed creation", kcID, uuid)
		return false
	}
	return true
}

func rollbackFailure(c *gin.Context, removed bool, kcID, msg string) {
	if removed {
		c.JSON(http.StatusInternalServerError, gin.H{"error": msg + "; it was removed from Keycloak"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": msg + "; the client could not be removed from Keycloak: " + kcID})
}

// CreateClient provisions a Keycloak client for a route and registers it.
//
// The order keeps a caller who may not create from learning anything about a
// route: who may create is decided before the route is read, and a missing
// route answers a non-admin what another team's route does.
func (h *IdPHandler) CreateClient(c *gin.Context) {
	// :id is the connection here; the instance is the one the RBAC middleware
	// checked the caller's role on.
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "X-Instance-ID is required"})
		return
	}
	ctx := c.Request.Context()
	p, err := h.idps.Get(ctx, c.Param("id"))
	switch {
	case errors.Is(err, services.ErrIdPNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Identity provider not found"})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Identity provider request failed"})
		return
	case !p.LinkedTo(instanceID):
		c.JSON(http.StatusNotFound, gin.H{"error": "Identity provider not found"})
		return
	}
	var req createClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if req.RouteID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "route_id is required"})
		return
	}
	if err := validateCreateRequest(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Coarse gate, before the gateway is asked anything.
	scope := callerTeamScope(c)
	if !scope.isAdmin && (scope.foreign || !p.DevelopersCanCreate || len(scope.writable) == 0) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	inst, err := h.getInstance(ctx, instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "The instance could not be read"})
		return
	}
	if inst == nil || !inst.IsActive {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found or inactive"})
		return
	}
	hosts, found, err := h.readRouteHosts(ctx, inst, req.RouteID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Could not read the route from the gateway"})
		return
	}
	if !found {
		if scope.isAdmin {
			c.JSON(http.StatusNotFound, gin.H{"error": "Route not found"})
		} else {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		}
		return
	}
	owner, err := h.routeOwner(ctx, instanceID, req.RouteID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "The route's owner could not be read"})
		return
	}
	if !mayCreateClient(scope, p, owner) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	// Before any Keycloak call: the URI against the hosts of the route. A
	// route with no host, its service's included, gives nothing to bind it to:
	// only an admin may then choose the address.
	redirect := ""
	if req.Mode == "login" {
		redirect = req.RedirectURI
		switch {
		case len(hosts) > 0:
			if err := validRedirectURI(redirect, hosts); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		case !scope.isAdmin:
			c.JSON(http.StatusForbidden, gin.H{"error": "an admin must create a login client for a route with no host"})
			return
		}
	}
	opts := normalizedOptions(req)

	kcID := p.ClientIDPrefix + req.ClientID
	kc := h.keycloak(p)
	uuid, err := kc.CreateClient(ctx, services.BuildClientRepresentation(kcID, req.Mode, opts, redirect))
	if err != nil {
		keycloakFailure(c, err)
		return
	}
	secret, err := kc.ClientSecret(ctx, uuid)
	if err != nil {
		removed := rollbackClient(ctx, kc, kcID, uuid)
		if !removed {
			rollbackFailure(c, false, kcID, "Could not read the client's secret")
			return
		}
		keycloakFailure(c, err)
		return
	}
	entry := &models.IdPClient{
		IdPID: p.ID, InstanceID: instanceID, Realm: p.Realm, Prefix: p.ClientIDPrefix,
		ClientID: kcID, KeycloakUUID: uuid, RouteID: req.RouteID, Mode: req.Mode,
		Options: opts, RedirectURI: redirect, CreatedBy: middleware.GetUserID(c),
	}
	if err := h.idps.RecordClient(ctx, entry); err != nil {
		rollbackFailure(c, rollbackClient(ctx, kc, kcID, uuid), kcID, "Could not register the client")
		return
	}
	out := clientCredentials{
		ClientID: kcID, ClientSecret: secret, Discovery: services.DiscoveryURL(p),
		Mode: req.Mode, Options: opts, RedirectURI: redirect,
	}
	if req.Mode == "token" && opts.Validation == "introspection" {
		out.IntrospectionEndpoint = services.IntrospectionURL(p)
	}
	c.JSON(http.StatusCreated, out)
}

// mayUseClient: an admin always; anyone else when they write to the team that
// currently owns the client's route.
func mayUseClient(scope teamScope, team string) bool {
	return scope.isAdmin || scope.mayWrite(team)
}

// clientListItem is one registry entry as the list shows it. Status and Routes
// are filled by the status variant only.
type clientListItem struct {
	UUID     string   `json:"uuid"`
	ClientID string   `json:"client_id"`
	IdPID    string   `json:"idp_id"`
	IdPName  string   `json:"idp_name"`
	RouteID  string   `json:"route_id"`
	TeamID   string   `json:"team_id"`
	Mode     string   `json:"mode"`
	Status   string   `json:"status,omitempty"`
	Routes   []string `json:"routes,omitempty"`
}

// activeInstance reads the instance of the path and answers 404 or 500 when it
// cannot be used.
func (h *IdPHandler) activeInstance(c *gin.Context, instanceID string) bool {
	inst, err := h.getInstance(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "The instance could not be read"})
		return false
	}
	if inst == nil || !inst.IsActive {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found or inactive"})
		return false
	}
	return true
}

// ListClients lists the registry entries of an instance the caller may use.
// The team of each is the live owner of its route, never a stored copy.
func (h *IdPHandler) ListClients(c *gin.Context) {
	instanceID, ok := requirePathInstance(c)
	if !ok {
		return
	}
	scope := callerTeamScope(c)
	// A viewer has nothing to use; the status variant is for admins.
	if !scope.isAdmin && (scope.foreign || len(scope.writable) == 0 || c.Query("status") != "") {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	if !h.activeInstance(c, instanceID) {
		return
	}
	ctx := c.Request.Context()
	entries, err := h.idps.ListClients(ctx, instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Clients could not be read"})
		return
	}
	names := map[string]string{}
	out := []clientListItem{}
	for _, e := range entries {
		name, known := names[e.IdPID]
		if !known {
			p, err := h.idps.Get(ctx, e.IdPID)
			switch {
			case errors.Is(err, services.ErrIdPNotFound):
				names[e.IdPID] = ""
				continue
			case err != nil:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Identity provider request failed"})
				return
			}
			name = p.Name
			names[e.IdPID] = name
		}
		if name == "" {
			continue // the connection is gone
		}
		team, err := h.routeOwner(ctx, instanceID, e.RouteID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "The route's owner could not be read"})
			return
		}
		if !mayUseClient(scope, team) {
			continue
		}
		out = append(out, clientListItem{
			UUID: e.KeycloakUUID, ClientID: e.ClientID, IdPID: e.IdPID, IdPName: name,
			RouteID: e.RouteID, TeamID: team, Mode: e.Mode,
		})
	}
	c.JSON(http.StatusOK, out)
}

// UseClient answers what the openid-connect plugin needs for a client the
// dashboard created, reading its secret from Keycloak now. A caller who may
// not use it, and one naming a client that does not exist, get the same 403:
// the path tells nobody which clients exist.
func (h *IdPHandler) UseClient(c *gin.Context) {
	instanceID, ok := requirePathInstance(c)
	if !ok {
		return
	}
	scope := callerTeamScope(c)
	if !scope.isAdmin && (scope.foreign || len(scope.writable) == 0) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	if !h.activeInstance(c, instanceID) {
		return
	}
	ctx := c.Request.Context()
	// notFound is what a client that is not there answers this caller.
	notFound := func(msg string) {
		if scope.isAdmin {
			c.JSON(http.StatusNotFound, gin.H{"error": msg})
		} else {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		}
	}
	entry, err := h.idps.FindClient(ctx, instanceID, c.Param("uuid"))
	switch {
	case errors.Is(err, services.ErrIdPNotFound):
		notFound("Client not found")
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Clients could not be read"})
		return
	}
	team, err := h.routeOwner(ctx, instanceID, entry.RouteID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "The route's owner could not be read"})
		return
	}
	if !mayUseClient(scope, team) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	p, err := h.idps.Get(ctx, entry.IdPID)
	switch {
	case errors.Is(err, services.ErrIdPNotFound):
		notFound("Identity provider not found")
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Identity provider request failed"})
		return
	}
	secret, err := h.keycloak(p).ClientSecret(ctx, entry.KeycloakUUID)
	if errors.Is(err, services.ErrKeycloakClientMissing) {
		c.JSON(http.StatusGone, gin.H{"error": "the client no longer exists in Keycloak"})
		return
	}
	if err != nil {
		keycloakFailure(c, err)
		return
	}
	out := clientCredentials{
		ClientID: entry.ClientID, ClientSecret: secret, Discovery: services.DiscoveryURL(p),
		Mode: entry.Mode, Options: entry.Options, RedirectURI: entry.RedirectURI,
	}
	if entry.Mode == "token" && entry.Options.Validation == "introspection" {
		out.IntrospectionEndpoint = services.IntrospectionURL(p)
	}
	c.JSON(http.StatusOK, out)
}

// keycloakFailure maps an error of a Keycloak call to a response. Nothing of
// a dial error or an internal address reaches the caller.
func keycloakFailure(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrKeycloakClientExists):
		c.JSON(http.StatusConflict, gin.H{"error": "this client ID already exists in Keycloak, choose another"})
	case errors.Is(err, services.ErrKeycloakUnavailable):
		c.JSON(http.StatusBadGateway, gin.H{"error": "Keycloak could not be reached"})
	case errors.Is(err, services.ErrKeycloakAuth):
		c.JSON(http.StatusBadGateway, gin.H{"error": capKeycloakMessage(services.ErrKeycloakAuth)})
	case errors.Is(err, services.ErrKeycloakForbidden):
		c.JSON(http.StatusBadGateway, gin.H{"error": capKeycloakMessage(services.ErrKeycloakForbidden)})
	default:
		c.JSON(http.StatusBadGateway, gin.H{"error": "Keycloak request failed"})
	}
}
