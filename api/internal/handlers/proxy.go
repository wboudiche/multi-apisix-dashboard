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
	"context"
	"encoding/json"
	"fmt"
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

// dashboardFieldPrefix marks fields the dashboard adds to APISIX resources for
// its own use. APISIX rejects unknown properties, so these must never reach it.
//
// To be stripped back out, an injected field must carry this prefix AND sit at
// the top level of whatever a client sends back: the strip below is deliberately
// shallow. That is enough today because the only injection is __team_id on a
// list row's "value" (see dashboardTeamIDField), and clients round-trip that
// "value" object itself. A nested injection would need the strip to recurse.
const dashboardFieldPrefix = "__"

// dashboardTeamIDField is injected into list responses so the UI can show team
// ownership. Named here rather than written literally at the injection site so
// it cannot drift away from the prefix the strip looks for.
const dashboardTeamIDField = dashboardFieldPrefix + "team_id"

// stripDashboardFields removes the dashboard's own fields from a request body
// bound for APISIX. A body that is not a JSON object is returned untouched.
func stripDashboardFields(body []byte) []byte {
	if len(body) == 0 {
		return body
	}

	// UseNumber keeps integers exact. Decoding into map[string]any otherwise
	// turns every number into a float64, and re-marshalling would silently
	// rewrite an ID beyond 2^53 to a neighbouring value.
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	var resource map[string]any
	if err := decoder.Decode(&resource); err != nil || resource == nil {
		// Not a JSON object (an array, a scalar, or malformed). Forward it
		// verbatim and let APISIX be the judge.
		return body
	}

	stripped := false
	for key := range resource {
		if strings.HasPrefix(key, dashboardFieldPrefix) {
			delete(resource, key)
			stripped = true
		}
	}
	if !stripped {
		// Nothing to remove, so forward the original bytes rather than a
		// re-serialized copy.
		return body
	}

	cleaned, err := json.Marshal(resource)
	if err != nil {
		// Unreachable in practice: a map decoded from JSON always re-marshals.
		// Forwarding the original means the dashboard field reaches APISIX and
		// is rejected with a clear error, which beats dropping the request.
		return body
	}
	return cleaned
}

// unassignedResourceCode marks a refusal caused by the resource having no team,
// so the UI can tell it apart from "owned by another team" and point the
// operator at an admin rather than at a team that does not exist.
const unassignedResourceCode = "resource_not_assigned"

// alreadyExistsCode marks a create refused because the id is taken, so the UI
// can point at the field rather than show a generic failure.
const alreadyExistsCode = "resource_already_exists"

// createOnlyRequested reports whether the caller asked for a create that must
// not overwrite anything.
//
// APISIX's PUT is an upsert, so an "Add" form that PUTs an id the user already
// used replaces the existing record and reports success. The Add flows cannot be
// told apart from the Edit flows at this layer - both PUT the same path - so
// they declare their intent with If-None-Match: *, the standard way to ask that
// a request apply only when nothing is there. Edits send no such header and keep
// overwriting, which is what editing is.
func createOnlyRequested(method, ifNoneMatch string) bool {
	return method == http.MethodPut && strings.TrimSpace(ifNoneMatch) == "*"
}

// Messages for the proxy's authorization refusals.
const (
	unassignedResourceMsg = "This resource is not assigned to a team. Ask an admin to assign it before editing."
	alreadyExistsMsg      = "A resource with this name or ID already exists. Choose a different one, or edit the existing resource."
	couldNotVerifyMsg     = "Could not verify the resource before writing to it"
	otherTeamMsg          = "Resource owned by another team"
	accessDeniedMsg       = "Access denied to this resource"
)

// nonAdminMayAccess reports whether a non-admin whose team is callerTeamID may
// see or modify a resource owned by ownerTeamID.
//
// A resource with no team is administrative territory: it is invisible and
// unwritable to non-admins until an admin assigns it (see ReassignOwnership).
// Resources predating the dashboard, or created directly against the Admin API,
// arrive in exactly that state.
//
// A caller with no team of their own passes nothing: they own no resources, and
// unowned resources must not become a free-for-all for teamless accounts.
func nonAdminMayAccess(ownerTeamID, callerTeamID string) bool {
	return ownerTeamID != "" && ownerTeamID == callerTeamID
}

// unownedWriteDenied decides a write against a resource carrying no ownership
// record, given whether that resource already exists on the gateway.
//
// The absence of an ownership record is ambiguous. A PUT to an id that does not
// exist yet is a create - which is how consumers and consumer_groups are made,
// keyed by username - and ordinary work for a developer. A write to an id that
// does exist is a write to somebody's unassigned resource, which is admin-only.
func unownedWriteDenied(resourceExists bool) bool {
	return resourceExists
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

// resourceExists asks the instance's Admin API whether the resource at path is
// already there. Used to tell a creating PUT apart from a write against an
// existing but unassigned resource.
func (h *ProxyHandler) resourceExists(ctx context.Context, instance *models.Instance, path string) (bool, error) {
	targetURL := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin" + path

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return false, err
	}
	if instance.AdminKey != "" {
		req.Header.Set("X-API-Key", instance.AdminKey)
	}

	resp, err := proxyClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return true, nil
	default:
		return false, fmt.Errorf("admin API returned status %d", resp.StatusCode)
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

	// An Add flow declares that it means to create. APISIX would happily upsert,
	// replacing whatever is already at that id and returning a success the UI
	// reports as "Add ... Successfully" - the only trace being a changed
	// update_time on a row the user thought they were adding.
	//
	// resourceID is only used here to confirm the request targets a specific
	// resource rather than a collection; the existence check uses the whole
	// path, which is what makes this work for secrets too - they are addressed
	// as /secrets/{manager}/{id}, where getResourceMetadata reports the manager
	// as the id.
	if createOnlyRequested(c.Request.Method, c.GetHeader("If-None-Match")) && resourceID != "" {
		exists, err := h.resourceExists(c.Request.Context(), instance, path)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error":     couldNotVerifyMsg,
				"error_msg": couldNotVerifyMsg,
			})
			c.Abort()
			return
		}
		if exists {
			c.JSON(http.StatusConflict, gin.H{
				"error":     alreadyExistsMsg,
				"error_msg": alreadyExistsMsg,
				"code":      alreadyExistsCode,
			})
			c.Abort()
			return
		}
	}

	if !isAdmin {
		if (c.Request.Method == http.MethodPut || c.Request.Method == http.MethodPatch || c.Request.Method == http.MethodDelete) && resourceID != "" {
			ownerTeamID, _ := h.ownershipService.GetOwner(c.Request.Context(), instanceID, resourceType, resourceID)

			if ownerTeamID == "" {
				// No ownership record. Either this creates something new - a PUT
				// to an id that does not exist yet, which is how consumers and
				// consumer_groups are made - or it targets a resource that
				// exists without a team, which only an admin may change.
				exists, err := h.resourceExists(c.Request.Context(), instance, path)
				if err != nil {
					// Fail closed: an unverifiable target is not a licence to
					// overwrite it.
					c.JSON(http.StatusBadGateway, gin.H{
						"error":     couldNotVerifyMsg,
						"error_msg": couldNotVerifyMsg,
					})
					c.Abort()
					return
				}
				if unownedWriteDenied(exists) {
					// error_msg as well as error: `req` (the APISIX admin
					// client) renders a failure from error_msg/message, so a
					// refusal carrying only `error` shows the user a blank toast.
					c.JSON(http.StatusForbidden, gin.H{
						"error":     unassignedResourceMsg,
						"error_msg": unassignedResourceMsg,
						"code":      unassignedResourceCode,
					})
					c.Abort()
					return
				}
			} else if !nonAdminMayAccess(ownerTeamID, effectiveTeamID) {
				c.JSON(http.StatusForbidden, gin.H{
					"error":     otherTeamMsg,
					"error_msg": otherTeamMsg,
				})
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

	// The dashboard injects its own fields into GET responses (see step 4). A
	// client that round-trips a resource it just read - duplicating a route,
	// saving the JSON editor - would send them straight back, and APISIX rejects
	// unknown properties. Strip them here, at the same boundary that added them,
	// so every write path is covered rather than each caller remembering to.
	if c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPut ||
		c.Request.Method == http.MethodPatch {
		bodyBytes = stripDashboardFields(bodyBytes)
	}

	proxyReq, _ := http.NewRequest(c.Request.Method, targetURL, bytes.NewReader(bodyBytes))
	for key, values := range c.Request.Header {
		// If-None-Match is a contract between the dashboard and this proxy
		// (see createOnlyRequested); APISIX has no business acting on it.
		if key != "Host" && key != "Authorization" && key != "If-None-Match" {
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
						val[dashboardTeamIDField] = ownerTeamID

						// Filter for non-admin users. Unowned resources are
						// admin-only, so they are hidden here too — the same
						// rule the write guard above applies.
						if !isAdmin && !nonAdminMayAccess(ownerTeamID, effectiveTeamID) {
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
			if !nonAdminMayAccess(ownerTeamID, effectiveTeamID) {
				c.JSON(http.StatusForbidden, gin.H{
					"error":     accessDeniedMsg,
					"error_msg": accessDeniedMsg,
				})
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
