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
	"log"
	"net/http"
	"strings"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

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
	role := middleware.GetRole(c)

	var effectiveTeamID string
	if role == models.RoleSuperAdmin || role == models.RoleInstanceAdmin {
		effectiveTeamID = c.GetHeader("X-Team-ID")
	} else if ui != nil {
		effectiveTeamID = ui.TeamID
	}

	instanceID := c.GetHeader("X-Instance-ID")
	if instanceID == "" {
		instanceID = c.Query("instance_id")
	}
	if instanceID == "" {
		instanceID = middleware.GetInstanceID(c)
	}

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

	resourceType, resourceID := h.getResourceMetadata(path)
	log.Printf("[DEBUG Proxy] Context: ResourceType=%s, ResourceID=%s, Method=%s", resourceType, resourceID, c.Request.Method)

	// 1. Pre-mutation checks (PUT, PATCH, DELETE)
	if role != models.RoleSuperAdmin && role != models.RoleInstanceAdmin {
		if (c.Request.Method == http.MethodPut || c.Request.Method == http.MethodPatch || c.Request.Method == http.MethodDelete) && resourceID != "" {
			ownerTeamID, _ := h.ownershipService.GetOwner(c.Request.Context(), instanceID, resourceType, resourceID)
			if ownerTeamID != "" && ownerTeamID != effectiveTeamID {
				log.Printf("[DEBUG Proxy] Blocked mutation: Owner=%s, UserTeam=%s", ownerTeamID, effectiveTeamID)
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

	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to connect to APISIX: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		log.Printf("[DEBUG Proxy] Target responded with %d: %s", resp.StatusCode, string(respBody))
	}

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
			log.Printf("[DEBUG Proxy] Recording ownership: %s/%s -> %s", resourceType, resourceID, effectiveTeamID)
			h.ownershipService.SetOwner(c.Request.Context(), &models.Ownership{
				InstanceID:   instanceID,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				TeamID:       effectiveTeamID,
			})
		}
	}

	// 4. GET: Enrich list responses with __team_id and filter for non-admins
	if c.Request.Method == http.MethodGet && resp.StatusCode == http.StatusOK {
		isAdmin := role == models.RoleSuperAdmin || role == models.RoleInstanceAdmin
		isList := strings.HasSuffix(path, "/routes") || strings.HasSuffix(path, "/services") || strings.HasSuffix(path, "/upstreams")
		isSingle := resourceID != "" && (strings.Contains(path, "/routes/") || strings.Contains(path, "/services/") || strings.Contains(path, "/upstreams/"))

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
						id, _ := val["id"].(string)
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
		} else if isSingle && !isAdmin {
			ownerTeamID, _ := h.ownershipService.GetOwner(c.Request.Context(), instanceID, resourceType, resourceID)
			if effectiveTeamID != "" && ownerTeamID != effectiveTeamID {
				log.Printf("[DEBUG Proxy] Blocked access to single resource: Owner=%s, UserTeam=%s", ownerTeamID, effectiveTeamID)
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
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin && role != models.RoleInstanceAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can reassign ownership"})
		return
	}

	instanceID := c.GetHeader("X-Instance-ID")
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
