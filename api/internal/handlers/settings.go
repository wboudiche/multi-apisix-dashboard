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

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

type SettingsHandler struct {
	policyService *services.PolicyService
}

func NewSettingsHandler(policyService *services.PolicyService) *SettingsHandler {
	return &SettingsHandler{policyService: policyService}
}

// GetPasswordPolicy returns the effective password policy (any authenticated user).
func (h *SettingsHandler) GetPasswordPolicy(c *gin.Context) {
	p, err := h.policyService.LoadPolicy(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load policy"})
		return
	}
	c.JSON(http.StatusOK, p)
}

// UpdatePasswordPolicy replaces the policy (super_admin only).
func (h *SettingsHandler) UpdatePasswordPolicy(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	var p models.PasswordPolicy
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.policyService.SavePolicy(c.Request.Context(), p); err != nil {
		if errors.Is(err, services.ErrInvalidPolicy) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save policy"})
		return
	}
	c.JSON(http.StatusOK, p)
}
