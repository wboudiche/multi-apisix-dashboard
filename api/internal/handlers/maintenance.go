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
	"log"
	"net/http"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

// MaintenanceHandler exposes the dry run and the purge of data nothing refers
// to any more. Both are super_admin only, and neither acts on its own: the list
// removes nothing, and the purge removes only the keys it is sent.
type MaintenanceHandler struct {
	maintenance *services.MaintenanceService
}

func NewMaintenanceHandler(maintenance *services.MaintenanceService) *MaintenanceHandler {
	return &MaintenanceHandler{maintenance: maintenance}
}

// ListOrphans answers what a purge could remove, and removes nothing.
func (h *MaintenanceHandler) ListOrphans(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	assignments, err := h.maintenance.FindOrphanedUserInstances(c.Request.Context())
	if err != nil {
		c.JSON(orphanReadStatus(err), gin.H{"error": err.Error()})
		return
	}
	ownership, err := h.maintenance.FindOrphanedOwnership(c.Request.Context())
	if err != nil {
		c.JSON(orphanReadStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"user_instances": assignments,
		"ownership":      ownership.Orphans,
		// Instances, or types on them, whose records for shared types were not
		// judged, because their gateway could not say what it holds.
		"unchecked_instances": ownership.Unchecked,
	})
}

// PurgeOrphansRequest names the keys to remove, as ListOrphans returned them.
type PurgeOrphansRequest struct {
	UserInstances []string `json:"user_instances"`
	Ownership     []string `json:"ownership"`
}

// PurgeOrphans removes the keys it is sent, each only if it is still orphaned.
func (h *MaintenanceHandler) PurgeOrphans(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req PurgeOrphansRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.UserInstances)+len(req.Ownership) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Name the keys to purge, as GET /api/v1/maintenance/orphans lists them",
		})
		return
	}

	// Each kind is swept only when keys of that kind are sent: a purge of
	// ownership records has no reason to fail on a read of the users, nor to
	// wait on every gateway for a purge of assignments.
	assignments := emptyPurgeResult()
	if len(req.UserInstances) > 0 {
		result, err := h.maintenance.PurgeOrphanedUserInstances(c.Request.Context(), req.UserInstances)
		if err != nil {
			c.JSON(orphanReadStatus(err), gin.H{"error": err.Error()})
			return
		}
		assignments = result
		for _, key := range result.Deleted {
			log.Printf("[maintenance] %s removed orphaned instance assignment %s", middleware.GetUsername(c), key)
		}
	}
	ownership := emptyPurgeResult()
	if len(req.Ownership) > 0 {
		result, err := h.maintenance.PurgeOrphanedOwnership(c.Request.Context(), req.Ownership)
		if err != nil {
			c.JSON(orphanReadStatus(err), gin.H{"error": err.Error(), "user_instances": assignments})
			return
		}
		ownership = result
		for _, key := range result.Deleted {
			log.Printf("[maintenance] %s removed orphaned ownership record %s", middleware.GetUsername(c), key)
		}
	}

	status := http.StatusOK
	if len(assignments.Failed)+len(ownership.Failed) > 0 {
		status = http.StatusInternalServerError
	}
	c.JSON(status, gin.H{"user_instances": assignments, "ownership": ownership})
}

func emptyPurgeResult() *services.PurgeResult {
	return &services.PurgeResult{Deleted: []string{}, Skipped: map[string]string{}, Failed: map[string]string{}}
}

// orphanReadStatus is the status for a failure to work out what is orphaned.
func orphanReadStatus(err error) int {
	if errors.Is(err, services.ErrNoUsersRead) {
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}
