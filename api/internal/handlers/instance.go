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
	"errors"
	"net/http"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

// Machine-readable codes on 409 responses, so the UI can tell a hard rejection
// from a conflict the operator is allowed to confirm past.
const (
	duplicateInstanceNameCode   = "duplicate_instance_name"
	duplicateAdminAPIURLCode    = "duplicate_admin_api_url"
	instanceHasDependenciesCode = "instance_has_dependencies"
)

type InstanceHandler struct {
	instanceService *services.InstanceService
	authService     *services.AuthService
	teamService     *services.TeamService
}

func NewInstanceHandler(instanceService *services.InstanceService, authService *services.AuthService, teamService *services.TeamService) *InstanceHandler {
	return &InstanceHandler{
		instanceService: instanceService,
		authService:     authService,
		teamService:     teamService,
	}
}

type CreateInstanceRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	AdminAPIURL string `json:"admin_api_url" binding:"required"`
	AdminKey    string `json:"admin_key" binding:"required"`
	GatewayURL  string `json:"gateway_url"`
	IsActive    bool   `json:"is_active"`
}

type UpdateInstanceRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	AdminAPIURL string `json:"admin_api_url"`
	AdminKey    string `json:"admin_key"`
	GatewayURL  string `json:"gateway_url"`
	IsActive    bool   `json:"is_active"`
}

type SetUserInstanceRoleRequest struct {
	Role   string        `json:"role" binding:"required"`
	TeamID string        `json:"team_id"`
	Scope  *models.Scope `json:"scope"`
}

// InstanceResponse is an instance plus any non-fatal advisory about it. The
// instance fields are inlined, so existing clients see the shape they always saw.
type InstanceResponse struct {
	*models.Instance
	// ConnectionWarning is set when the instance was saved but its Admin API did
	// not answer, so the caller can say so instead of reporting a clean success.
	ConnectionWarning string `json:"connection_warning,omitempty"`
}

// isForced reports whether the caller explicitly confirmed an operation that
// would otherwise be held back by a conflict or dependency check.
func isForced(c *gin.Context) bool {
	return c.Query("force") == "true"
}

// connectionWarning probes the instance's Admin API and returns a human-readable
// warning when it cannot be reached. An unreachable gateway does not block the
// save - operators legitimately register an instance before it is running - but
// it must never be reported as a clean success.
func (h *InstanceHandler) connectionWarning(c *gin.Context, instance *models.Instance) string {
	if err := h.instanceService.TestConnection(c.Request.Context(), instance); err != nil {
		return "Instance saved, but its Admin API could not be reached: " + err.Error()
	}
	return ""
}

// CreateInstance creates a new APISIX instance (super_admin only)
func (h *InstanceHandler) CreateInstance(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req CreateInstanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// A duplicate name is a hard rejection, so report it before the Admin API URL
	// warning - otherwise the operator confirms past the warning only to be
	// stopped by the name anyway. CreateInstance re-checks this authoritatively.
	nameConflict, err := h.instanceService.FindNameConflict(c.Request.Context(), req.Name, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if nameConflict != nil {
		c.JSON(http.StatusConflict, gin.H{
			"error": services.ErrDuplicateInstanceName.Error(),
			"code":  duplicateInstanceNameCode,
		})
		return
	}

	// Two instances may legitimately address one gateway with different admin
	// keys, so a shared Admin API URL is a warning the caller confirms, not an error.
	if !isForced(c) {
		conflict, err := h.instanceService.FindAdminAPIURLConflict(c.Request.Context(), req.AdminAPIURL, "")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if conflict != nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":                "Another instance already uses this Admin API URL",
				"code":                 duplicateAdminAPIURLCode,
				"conflicting_instance": conflict.Name,
			})
			return
		}
	}

	instance := &models.Instance{
		Name:        req.Name,
		Description: req.Description,
		AdminAPIURL: req.AdminAPIURL,
		AdminKey:    req.AdminKey,
		GatewayURL:  req.GatewayURL,
		IsActive:    req.IsActive,
	}

	if err := h.instanceService.CreateInstance(c.Request.Context(), instance); err != nil {
		if errors.Is(err, services.ErrDuplicateInstanceName) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": duplicateInstanceNameCode})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	warning := h.connectionWarning(c, instance)

	// Don't return admin key in response
	instance.AdminKey = ""
	c.JSON(http.StatusCreated, InstanceResponse{Instance: instance, ConnectionWarning: warning})
}

// ListInstances lists all instances
func (h *InstanceHandler) ListInstances(c *gin.Context) {
	role := middleware.GetRole(c)
	userID := middleware.GetUserID(c)

	instances, err := h.instanceService.ListInstances(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Filter instances based on role
	if role == models.RoleSuperAdmin {
		// Super admin sees all
		for _, i := range instances {
			i.AdminKey = ""
		}
		c.JSON(http.StatusOK, instances)
		return
	}

	// Other users only see instances they have access to
	userInstances, err := h.authService.GetUserInstances(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	allowedIDs := make(map[string]bool)
	for _, ui := range userInstances {
		allowedIDs[ui.InstanceID] = true
	}

	filtered := make([]*models.Instance, 0)
	for _, i := range instances {
		if allowedIDs[i.ID] {
			i.AdminKey = ""
			filtered = append(filtered, i)
		}
	}

	c.JSON(http.StatusOK, filtered)
}

// GetInstance gets a specific instance
func (h *InstanceHandler) GetInstance(c *gin.Context) {
	instanceID := c.Param("id")

	instance, err := h.instanceService.GetInstance(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if instance == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found"})
		return
	}

	// Check access
	if !h.hasAccess(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	instance.AdminKey = ""
	c.JSON(http.StatusOK, instance)
}

// UpdateInstance updates an instance (super_admin only)
func (h *InstanceHandler) UpdateInstance(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	instanceID := c.Param("id")

	instance, err := h.instanceService.GetInstance(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if instance == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found"})
		return
	}

	var req UpdateInstanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != "" {
		nameConflict, err := h.instanceService.FindNameConflict(c.Request.Context(), req.Name, instanceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if nameConflict != nil {
			c.JSON(http.StatusConflict, gin.H{
				"error": services.ErrDuplicateInstanceName.Error(),
				"code":  duplicateInstanceNameCode,
			})
			return
		}
	}

	// Only an edit that actually changes the URL can introduce a new collision.
	// Re-warning about an unchanged URL would block every unrelated edit to an
	// instance that already shares a gateway - a conflict already confirmed once.
	urlChanged := req.AdminAPIURL != "" &&
		services.NormalizeAdminAPIURL(req.AdminAPIURL) != services.NormalizeAdminAPIURL(instance.AdminAPIURL)

	if urlChanged && !isForced(c) {
		conflict, err := h.instanceService.FindAdminAPIURLConflict(c.Request.Context(), req.AdminAPIURL, instanceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if conflict != nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":                "Another instance already uses this Admin API URL",
				"code":                 duplicateAdminAPIURLCode,
				"conflicting_instance": conflict.Name,
			})
			return
		}
	}

	if req.Name != "" {
		instance.Name = req.Name
	}
	if req.Description != "" {
		instance.Description = req.Description
	}
	if req.AdminAPIURL != "" {
		instance.AdminAPIURL = req.AdminAPIURL
	}
	if req.AdminKey != "" {
		instance.AdminKey = req.AdminKey
	}
	if req.GatewayURL != "" {
		instance.GatewayURL = req.GatewayURL
	}
	instance.IsActive = req.IsActive

	if err := h.instanceService.UpdateInstance(c.Request.Context(), instance); err != nil {
		if errors.Is(err, services.ErrDuplicateInstanceName) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": duplicateInstanceNameCode})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	warning := h.connectionWarning(c, instance)

	instance.AdminKey = ""
	c.JSON(http.StatusOK, InstanceResponse{Instance: instance, ConnectionWarning: warning})
}

// GetInstanceDependencies reports what still references an instance, so the UI
// can show the blast radius before asking the operator to confirm a delete
// (super_admin only)
func (h *InstanceHandler) GetInstanceDependencies(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	instance, err := h.instanceService.GetInstance(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if instance == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found"})
		return
	}

	deps, err := h.instanceService.GetInstanceDependencies(c.Request.Context(), instance)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, deps)
}

// DeleteInstance deletes an instance (super_admin only)
func (h *InstanceHandler) DeleteInstance(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	instanceID := c.Param("id")

	instance, err := h.instanceService.GetInstance(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if instance == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found"})
		return
	}

	// Report the blast radius before destroying anything. The caller retries with
	// ?force=true once the operator has seen what would be orphaned.
	if !isForced(c) {
		deps, err := h.instanceService.GetInstanceDependencies(c.Request.Context(), instance)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if deps.RequiresConfirmation() {
			c.JSON(http.StatusConflict, gin.H{
				"error":        "Instance still has attached resources",
				"code":         instanceHasDependenciesCode,
				"dependencies": deps,
			})
			return
		}
	}

	if err := h.instanceService.DeleteInstance(c.Request.Context(), instanceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Instance deleted"})
}

// TestConnection tests instance connectivity
func (h *InstanceHandler) TestConnection(c *gin.Context) {
	instanceID := c.Param("id")

	instance, err := h.instanceService.GetInstance(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if instance == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found"})
		return
	}

	// Check access
	if !h.hasAccess(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	err = h.instanceService.TestConnection(c.Request.Context(), instance)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Connection failed", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "connected"})
}

// SetUserInstanceRole assigns a role to a user for an instance (super_admin only)
func (h *InstanceHandler) SetUserInstanceRole(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	userID := c.Param("user_id")
	instanceID := c.Param("instance_id")

	var req SetUserInstanceRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Role == models.RoleDeveloper || req.Role == models.RoleViewer {
		if req.TeamID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "team_id is required for developer and viewer roles"})
			return
		}
	}
	if req.TeamID != "" {
		team, err := h.teamService.GetTeam(c.Request.Context(), req.TeamID)
		if err != nil || team == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team_id: team not found"})
			return
		}
	}

	ui := &models.UserInstance{
		UserID:     userID,
		InstanceID: instanceID,
		TeamID:     req.TeamID,
		Role:       req.Role,
		Scope:      req.Scope,
	}

	if err := h.authService.SetUserInstanceRole(c.Request.Context(), ui); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, ui)
}

// DeleteUserInstanceRole removes a user's access to an instance (super_admin only)
func (h *InstanceHandler) DeleteUserInstanceRole(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	userID := c.Param("user_id")
	instanceID := c.Param("instance_id")

	if err := h.authService.DeleteUserInstanceRole(c.Request.Context(), userID, instanceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Access removed"})
}

// GetUserInstances gets all instances a user has access to
func (h *InstanceHandler) GetUserInstances(c *gin.Context) {
	userID := c.Param("user_id")
	currentUserID := middleware.GetUserID(c)
	role := middleware.GetRole(c)

	// Users can only see their own assignments unless they're super_admin
	if userID != currentUserID && role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	userInstances, err := h.authService.GetUserInstances(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, userInstances)
}

func (h *InstanceHandler) hasAccess(c *gin.Context, instanceID string) bool {
	role := middleware.GetRole(c)
	userID := middleware.GetUserID(c)

	if role == models.RoleSuperAdmin {
		return true
	}

	uiRole, err := h.authService.GetUserInstanceRole(c.Request.Context(), userID, instanceID)
	return err == nil && uiRole != ""
}

// ListInstancesHealth returns the health status of all accessible instances
func (h *InstanceHandler) ListInstancesHealth(c *gin.Context) {
	instances, err := h.instanceService.ListInstances(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	healthResults := make([]models.InstanceHealth, 0, len(instances))
	for _, inst := range instances {
		health := models.InstanceHealth{
			InstanceID: inst.ID,
			Name:       inst.Name,
			LastCheck:  time.Now(),
		}

		if err := h.instanceService.TestConnection(c.Request.Context(), inst); err != nil {
			health.Status = "Disconnected"
			health.Error = err.Error()
		} else {
			health.Status = "Connected"
		}

		healthResults = append(healthResults, health)
	}

	c.JSON(http.StatusOK, healthResults)
}
