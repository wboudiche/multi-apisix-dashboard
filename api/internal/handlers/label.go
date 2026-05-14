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
	"net/http"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
	"github.com/gin-gonic/gin"
)

type LabelHandler struct {
	labelService *services.LabelService
	authService  *services.AuthService
}

func NewLabelHandler(labelService *services.LabelService, authService *services.AuthService) *LabelHandler {
	return &LabelHandler{labelService: labelService, authService: authService}
}

type CreateLabelRequest struct {
	Key         string   `json:"key"`
	DisplayName string   `json:"display_name" binding:"required"`
	Color       string   `json:"color" binding:"required"`
	Values      []string `json:"values"`
}

type UpdateLabelRequest struct {
	DisplayName string   `json:"display_name"`
	Color       string   `json:"color"`
	Values      []string `json:"values"`
}

// isLabelAdmin checks if the user has admin rights for labels on the given instance.
func (h *LabelHandler) isLabelAdmin(c *gin.Context, instanceID string) bool {
	if middleware.GetRole(c) == models.RoleSuperAdmin {
		return true
	}
	userID := middleware.GetUserID(c)
	ui, err := h.authService.GetUserInstance(c.Request.Context(), userID, instanceID)
	if err != nil || ui == nil {
		return false
	}
	return ui.Role == models.RoleInstanceAdmin
}

func (h *LabelHandler) ListLabels(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	labels, err := h.labelService.ListLabels(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"list": labels, "total": len(labels)})
}

func (h *LabelHandler) CreateLabel(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	if !h.isLabelAdmin(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can manage labels"})
		return
	}

	var req CreateLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key := req.Key
	if key == "" {
		key = services.SlugFromDisplayName(req.DisplayName)
	}

	label := &models.Label{
		Key:         key,
		DisplayName: req.DisplayName,
		Color:       req.Color,
		Values:      req.Values,
		CreatedBy:   middleware.GetUserID(c),
	}

	if err := h.labelService.CreateLabel(c.Request.Context(), instanceID, label); err != nil {
		if err == services.ErrLabelExists {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"value": label})
}

func (h *LabelHandler) UpdateLabel(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	if !h.isLabelAdmin(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can manage labels"})
		return
	}

	key := c.Param("key")

	existing, err := h.labelService.GetLabel(c.Request.Context(), instanceID, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Label not found"})
		return
	}

	var req UpdateLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.DisplayName != "" {
		existing.DisplayName = req.DisplayName
	}
	if req.Color != "" {
		existing.Color = req.Color
	}
	if req.Values != nil {
		existing.Values = req.Values
	}

	if err := h.labelService.UpdateLabel(c.Request.Context(), instanceID, existing); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"value": existing})
}

func (h *LabelHandler) DeleteLabel(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	if !h.isLabelAdmin(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can manage labels"})
		return
	}

	key := c.Param("key")

	if err := h.labelService.DeleteLabel(c.Request.Context(), instanceID, key); err != nil {
		if err == services.ErrLabelNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}
