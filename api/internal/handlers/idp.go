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
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

// IdPHandler serves the Keycloak connections and, in later endpoints, the
// clients provisioned through them.
type IdPHandler struct {
	idps      *services.IdPService
	ownership *services.OwnershipService
	instances *services.InstanceService
	// keycloak builds the Keycloak client of a connection: NewKeycloakClient
	// in main, a fake in tests.
	keycloak func(*models.IdentityProvider) services.KeycloakAPI
	// readRouteHosts and listRoutes read routes through an instance's Admin
	// API; injected so tests need no gateway. readRouteHosts answers the hosts
	// a route matches and whether the route exists.
	readRouteHosts func(ctx context.Context, inst *models.Instance, routeID string) (hosts []string, found bool, err error)
	listRoutes     func(ctx context.Context, inst *models.Instance) ([]map[string]any, error)
	// routeOwner and getInstance wrap the services that take a concrete etcd
	// client, so tests need none.
	routeOwner  func(ctx context.Context, instanceID, routeID string) (string, error)
	getInstance func(ctx context.Context, id string) (*models.Instance, error)
}

func NewIdPHandler(
	idps *services.IdPService,
	ownership *services.OwnershipService,
	instances *services.InstanceService,
	keycloak func(*models.IdentityProvider) services.KeycloakAPI,
	readRouteHosts func(ctx context.Context, inst *models.Instance, routeID string) ([]string, bool, error),
	listRoutes func(ctx context.Context, inst *models.Instance) ([]map[string]any, error),
) *IdPHandler {
	return &IdPHandler{
		idps:           idps,
		ownership:      ownership,
		instances:      instances,
		keycloak:       keycloak,
		readRouteHosts: readRouteHosts,
		listRoutes:     listRoutes,
		routeOwner: func(ctx context.Context, instanceID, routeID string) (string, error) {
			return ownership.GetOwner(ctx, instanceID, "routes", routeID)
		},
		getInstance: instances.GetInstance,
	}
}

// idpResponse is a connection as the API shows it: every field but the
// secret, with has_secret saying whether one is stored.
type idpResponse struct {
	ID                  string          `json:"id"`
	Name                string          `json:"name"`
	Type                string          `json:"type"`
	BaseURL             string          `json:"base_url"`
	Realm               string          `json:"realm"`
	AdminClientID       string          `json:"admin_client_id"`
	HasSecret           bool            `json:"has_secret"`
	ClientIDPrefix      string          `json:"client_id_prefix"`
	InstanceIDs         []string        `json:"instance_ids"`
	DevelopersCanCreate bool            `json:"developers_can_create"`
	RedirectDomains     []string        `json:"redirect_domains"`
	CreatedAt           models.NullTime `json:"created_at"`
	UpdatedAt           models.NullTime `json:"updated_at"`
}

// publicIdP is the only way a connection leaves the backend.
func publicIdP(p *models.IdentityProvider) idpResponse {
	ids := p.InstanceIDs
	if ids == nil {
		ids = []string{}
	}
	domains := p.RedirectDomains
	if domains == nil {
		domains = []string{}
	}
	return idpResponse{
		ID:                  p.ID,
		Name:                p.Name,
		Type:                p.Type,
		BaseURL:             p.BaseURL,
		Realm:               p.Realm,
		AdminClientID:       p.AdminClientID,
		HasSecret:           p.AdminClientSecret != "",
		ClientIDPrefix:      p.ClientIDPrefix,
		InstanceIDs:         ids,
		DevelopersCanCreate: p.DevelopersCanCreate,
		RedirectDomains:     domains,
		CreatedAt:           p.CreatedAt,
		UpdatedAt:           p.UpdatedAt,
	}
}

// linkedIdP is what the route form needs of a connection, never credentials.
type linkedIdP struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Discovery           string `json:"discovery"`
	DevelopersCanCreate bool   `json:"developers_can_create"`
}

// requirePathInstance checks that the :id of the path is the instance the RBAC
// middleware resolved from X-Instance-ID, so the role it checked is the role
// for the instance the path names. Otherwise it answers 400.
func requirePathInstance(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if id == "" || id != middleware.GetInstanceID(c) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "X-Instance-ID must match the instance in the path"})
		return "", false
	}
	return id, true
}

// requireSuperAdmin answers 403 to anyone but a super admin, as instance.go.
func requireSuperAdmin(c *gin.Context) bool {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return false
	}
	return true
}

// idpError maps a service error to a response. The messages of the invalid,
// locked and has-clients errors never contain the secret.
func idpError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrIdPInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, services.ErrIdPNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Identity provider not found"})
	case errors.Is(err, services.ErrIdPLocked), errors.Is(err, services.ErrIdPHasClients):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Identity provider request failed"})
	}
}

type createIdPRequest struct {
	Name                string   `json:"name"`
	BaseURL             string   `json:"base_url"`
	Realm               string   `json:"realm"`
	AdminClientID       string   `json:"admin_client_id"`
	AdminClientSecret   string   `json:"admin_client_secret"`
	ClientIDPrefix      string   `json:"client_id_prefix"`
	InstanceIDs         []string `json:"instance_ids"`
	DevelopersCanCreate bool     `json:"developers_can_create"`
	RedirectDomains     []string `json:"redirect_domains"`
}

type updateIdPRequest struct {
	Name                *string   `json:"name"`
	BaseURL             *string   `json:"base_url"`
	Realm               *string   `json:"realm"`
	AdminClientID       *string   `json:"admin_client_id"`
	AdminClientSecret   *string   `json:"admin_client_secret"`
	ClientIDPrefix      *string   `json:"client_id_prefix"`
	InstanceIDs         *[]string `json:"instance_ids"`
	DevelopersCanCreate *bool     `json:"developers_can_create"`
	RedirectDomains     *[]string `json:"redirect_domains"`
}

func (h *IdPHandler) ListIdPs(c *gin.Context) {
	if !requireSuperAdmin(c) {
		return
	}
	all, err := h.idps.List(c.Request.Context())
	if err != nil {
		idpError(c, err)
		return
	}
	out := make([]idpResponse, 0, len(all))
	for _, p := range all {
		out = append(out, publicIdP(p))
	}
	c.JSON(http.StatusOK, out)
}

func (h *IdPHandler) CreateIdP(c *gin.Context) {
	if !requireSuperAdmin(c) {
		return
	}
	var req createIdPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	p := &models.IdentityProvider{
		Name:                req.Name,
		Type:                models.IdPTypeKeycloak,
		BaseURL:             req.BaseURL,
		Realm:               req.Realm,
		AdminClientID:       req.AdminClientID,
		AdminClientSecret:   req.AdminClientSecret,
		ClientIDPrefix:      req.ClientIDPrefix,
		InstanceIDs:         req.InstanceIDs,
		DevelopersCanCreate: req.DevelopersCanCreate,
		RedirectDomains:     req.RedirectDomains,
	}
	if err := h.idps.Create(c.Request.Context(), p); err != nil {
		idpError(c, err)
		return
	}
	c.JSON(http.StatusCreated, publicIdP(p))
}

func (h *IdPHandler) GetIdP(c *gin.Context) {
	if !requireSuperAdmin(c) {
		return
	}
	p, err := h.idps.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		idpError(c, err)
		return
	}
	c.JSON(http.StatusOK, publicIdP(p))
}

func (h *IdPHandler) UpdateIdP(c *gin.Context) {
	if !requireSuperAdmin(c) {
		return
	}
	var req updateIdPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	p, err := h.idps.Update(c.Request.Context(), c.Param("id"), services.IdPUpdate{
		Name:                req.Name,
		BaseURL:             req.BaseURL,
		Realm:               req.Realm,
		AdminClientID:       req.AdminClientID,
		AdminClientSecret:   req.AdminClientSecret,
		ClientIDPrefix:      req.ClientIDPrefix,
		InstanceIDs:         req.InstanceIDs,
		DevelopersCanCreate: req.DevelopersCanCreate,
		RedirectDomains:     req.RedirectDomains,
	})
	if err != nil {
		idpError(c, err)
		return
	}
	c.JSON(http.StatusOK, publicIdP(p))
}

func (h *IdPHandler) DeleteIdP(c *gin.Context) {
	if !requireSuperAdmin(c) {
		return
	}
	force := c.Query("force") == "true"
	if err := h.idps.Delete(c.Request.Context(), c.Param("id"), force); err != nil {
		idpError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// TestIdP checks the stored connection. No body is read: the stored secret is
// never used with an address or realm the request supplies.
func (h *IdPHandler) TestIdP(c *gin.Context) {
	if !requireSuperAdmin(c) {
		return
	}
	p, err := h.idps.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		idpError(c, err)
		return
	}
	err = h.keycloak(p).TestAccess(c.Request.Context())
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"ok": true})
	case errors.Is(err, services.ErrKeycloakAuth):
		c.JSON(http.StatusOK, gin.H{"ok": false, "reason": "auth"})
	case errors.Is(err, services.ErrKeycloakForbidden):
		c.JSON(http.StatusOK, gin.H{"ok": false, "reason": "forbidden"})
	default:
		c.JSON(http.StatusOK, gin.H{"ok": false, "reason": "unavailable"})
	}
}

// ListLinkedIdPs lists the connections linked to the instance of the path, for
// its admins and for developers (in at least one team); a viewer is refused.
func (h *IdPHandler) ListLinkedIdPs(c *gin.Context) {
	instanceID, ok := requirePathInstance(c)
	if !ok {
		return
	}
	if !callerTeamScope(c).isAdmin {
		ui := middleware.GetUserInstance(c)
		if ui == nil || len(ui.WritableTeams()) == 0 {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
	}
	linked, err := h.idps.ForInstance(c.Request.Context(), instanceID)
	if err != nil {
		idpError(c, err)
		return
	}
	out := make([]linkedIdP, 0, len(linked))
	for _, p := range linked {
		out = append(out, linkedIdP{
			ID:                  p.ID,
			Name:                p.Name,
			Discovery:           services.DiscoveryURL(p),
			DevelopersCanCreate: p.DevelopersCanCreate,
		})
	}
	c.JSON(http.StatusOK, out)
}
