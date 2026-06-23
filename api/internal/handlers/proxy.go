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
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

var proxyClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	},
}

// teamScopedResources are the APISIX resource types whose objects are owned by
// a team (tracked in the ownership store). Reads of these must be filtered to
// the caller's team for non-admins. Catalog endpoints like plugins/labels are
// not team-owned and are intentionally excluded so they are never filtered.
var teamScopedResources = map[string]bool{
	"routes":          true,
	"services":        true,
	"upstreams":       true,
	"consumers":       true,
	"consumer_groups": true,
	"stream_routes":   true,
}

type ProxyHandler struct {
	instanceService  *services.InstanceService
	ownershipService *services.OwnershipService
}

func NewProxyHandler(instanceService *services.InstanceService, ownershipService *services.OwnershipService) *ProxyHandler {
	return &ProxyHandler{
		instanceService:  instanceService,
		ownershipService: ownershipService,
	}
}

func (h *ProxyHandler) getResourceMetadata(path string) (string, string) {
	path = strings.Trim(path, "/")
	// Path format: admin/services/id or services
	parts := strings.Split(path, "/")
	if len(parts) == 0 {
		return "", ""
	}

	resourceType := parts[0]
	if resourceType == "admin" && len(parts) > 1 {
		resourceType = parts[1]
	}

	resourceID := ""
	if len(parts) > 1 {
		if parts[0] == "admin" && len(parts) > 2 {
			resourceID = parts[2]
		} else if parts[0] != "admin" {
			resourceID = parts[1]
		}
	}

	return resourceType, resourceID
}

// ProxyRequest handles proxying requests to APISIX Admin API with Team-Based Ownership
func (h *ProxyHandler) ProxyRequest(c *gin.Context) {
	ui := middleware.GetUserInstance(c)
	jwtRole := middleware.GetRole(c)

	// Effective role MUST come from the per-instance UserInstance assignment,
	// not the JWT global claim. The only JWT-role shortcircuit honored is
	// super_admin. This prevents a globally-mis-roled user (e.g. one whose
	// User.Role was somehow set to instance_admin) from masquerading as an
	// admin on instances they have no business with.
	effRole := jwtRole
	isSuperAdmin := jwtRole == models.RoleSuperAdmin
	if !isSuperAdmin && ui != nil {
		effRole = ui.Role
	}
	isInstanceAdmin := !isSuperAdmin && ui != nil && ui.Role == models.RoleInstanceAdmin
	isAdmin := isSuperAdmin || isInstanceAdmin

	var effectiveTeamID string
	if isAdmin {
		effectiveTeamID = c.GetHeader("X-Team-ID")
	} else if ui != nil {
		effectiveTeamID = ui.TeamID
	}

	// Resolve the target instance through the same canonical helper RBACMiddleware
	// uses. Resolving it differently here (e.g. header-first vs RBAC's query-first)
	// would let a caller pass RBAC against one instance while the request executes
	// against another — a cross-instance privilege escalation.
	instanceID := middleware.GetInstanceID(c)

	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	instance, err := h.instanceService.GetInstance(c.Request.Context(), instanceID)
	if err != nil || instance == nil || !instance.IsActive {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found or inactive"})
		return
	}

	path := c.Param("path")
	if path == "" {
		path = c.Request.URL.Path
	}
	path = strings.TrimPrefix(path, "/api/v1/apisix")

	// Reject path traversal. The RBAC decision below is derived from the leading
	// path segment via getResourceMetadata, but the raw path is forwarded to
	// APISIX, which collapses "..". Without this guard a developer could send
	// "/routes/../ssls/<id>" — passing the routes permission check while the
	// request actually lands on the forbidden ssls resource.
	for _, seg := range strings.Split(path, "/") {
		if seg == ".." || seg == "." {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid path"})
			c.Abort()
			return
		}
	}

	resourceType, resourceID := h.getResourceMetadata(path)

	action := "write"
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		action = "read"
	}
	if resourceType != "" && !models.HasResourcePermission(effRole, resourceType, action) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Role not permitted for this resource"})
		c.Abort()
		return
	}

	if !isAdmin {
		if (c.Request.Method == http.MethodPut || c.Request.Method == http.MethodPatch || c.Request.Method == http.MethodDelete) && resourceID != "" {
			ownerTeamID, _ := h.ownershipService.GetOwner(c.Request.Context(), instanceID, resourceType, resourceID)
			if ownerTeamID != "" && ownerTeamID != effectiveTeamID {
				c.JSON(http.StatusForbidden, gin.H{"error": "Resource owned by another team"})
				c.Abort()
				return
			}
		}
	}

	// 2. Prepare and execute proxy request
	targetURL := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin" + path
	if len(c.Request.URL.Query()) > 0 {
		targetURL += "?" + c.Request.URL.Query().Encode()
	}

	var bodyBytes []byte
	if c.Request.Body != nil {
		bodyBytes, _ = io.ReadAll(c.Request.Body)
	}

	proxyReq, _ := http.NewRequest(c.Request.Method, targetURL, bytes.NewReader(bodyBytes))
	for key, values := range c.Request.Header {
		if key != "Host" && key != "Authorization" {
			for _, v := range values {
				proxyReq.Header.Add(key, v)
			}
		}
	}
	if instance.AdminKey != "" {
		proxyReq.Header.Set("X-API-Key", instance.AdminKey)
	}

	resp, err := proxyClient.Do(proxyReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to connect to APISIX: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// 3. Post-mutation: Record ownership for new objects
	if (resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated) &&
		(c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPut) {

		if resourceID == "" || resourceID == resourceType {
			// Try to find ID in response
			var result struct {
				Key   string `json:"key"`
				Value struct {
					ID string `json:"id"`
				} `json:"value"`
			}
			if err := json.Unmarshal(respBody, &result); err == nil {
				if result.Value.ID != "" {
					resourceID = result.Value.ID
				} else if result.Key != "" {
					idParts := strings.Split(result.Key, "/")
					resourceID = idParts[len(idParts)-1]
				}
			}
		}

		if resourceID != "" && effectiveTeamID != "" {
			h.ownershipService.SetOwner(c.Request.Context(), &models.Ownership{
				InstanceID:   instanceID,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				TeamID:       effectiveTeamID,
			})
		}
	}

	// 4. GET: Enrich list responses with __team_id and filter for non-admins.
	// Applies to every team-owned resource type — not just routes/services/
	// upstreams — so a non-admin cannot read another team's consumers,
	// consumer_groups or stream_routes.
	if c.Request.Method == http.MethodGet && resp.StatusCode == http.StatusOK && teamScopedResources[resourceType] {
		isList := resourceID == ""

		if isList {
			var resources struct {
				List  []map[string]interface{} `json:"list"`
				Total int                      `json:"total"`
			}
			if err := json.Unmarshal(respBody, &resources); err == nil {
				// Batch fetch all ownerships for this resource type
				ownerMap, _ := h.ownershipService.ListOwnersByResourceType(c.Request.Context(), instanceID, resourceType)

				filtered := make([]map[string]interface{}, 0, len(resources.List))
				for _, r := range resources.List {
					val, ok := r["value"].(map[string]interface{})
					if ok {
						// Consumers are keyed by username; everything else by id.
						id, _ := val["id"].(string)
						if id == "" {
							id, _ = val["username"].(string)
						}
						ownerTeamID := ownerMap[id]

						// Inject __team_id for all users
						val["__team_id"] = ownerTeamID

						// Filter for non-admin users
						if !isAdmin && effectiveTeamID != "" && ownerTeamID != effectiveTeamID {
							continue
						}
					}
					filtered = append(filtered, r)
				}
				if !isAdmin {
					resources.Total = len(filtered)
				}
				resources.List = filtered
				respBody, _ = json.Marshal(resources)
			}
		} else if !isAdmin {
			ownerTeamID, _ := h.ownershipService.GetOwner(c.Request.Context(), instanceID, resourceType, resourceID)
			if effectiveTeamID != "" && ownerTeamID != effectiveTeamID {
				c.JSON(http.StatusForbidden, gin.H{"error": "Access denied to this resource"})
				return
			}
		}
	}

	for k, v := range resp.Header {
		for _, vv := range v {
			c.Header(k, vv)
		}
	}
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
}

func (h *ProxyHandler) ListRoutes(c *gin.Context)    { h.ProxyRequest(c) }
func (h *ProxyHandler) ListServices(c *gin.Context)  { h.ProxyRequest(c) }
func (h *ProxyHandler) ListUpstreams(c *gin.Context) { h.ProxyRequest(c) }

// ReassignOwnership changes the team owner of a resource (admin only)
func (h *ProxyHandler) ReassignOwnership(c *gin.Context) {
	jwtRole := middleware.GetRole(c)
	ui := middleware.GetUserInstance(c)
	isSuperAdmin := jwtRole == models.RoleSuperAdmin
	isInstanceAdmin := !isSuperAdmin && ui != nil && ui.Role == models.RoleInstanceAdmin
	if !isSuperAdmin && !isInstanceAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can reassign ownership"})
		return
	}

	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	resourceType := c.Param("resource_type")
	resourceID := c.Param("resource_id")

	var body struct {
		TeamID string `json:"team_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "team_id is required"})
		return
	}

	err := h.ownershipService.SetOwner(c.Request.Context(), &models.Ownership{
		InstanceID:   instanceID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		TeamID:       body.TeamID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reassign: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Ownership reassigned",
		"resource_type": resourceType,
		"resource_id":   resourceID,
		"team_id":       body.TeamID,
	})
}
