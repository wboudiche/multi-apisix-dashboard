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
	"fmt"
	"net/http"
	"strings"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

type TeamHandler struct {
	teamService      *services.TeamService
	ownershipService *services.OwnershipService
	authService      *services.AuthService
}

func NewTeamHandler(teamService *services.TeamService, ownershipService *services.OwnershipService, authService *services.AuthService) *TeamHandler {
	return &TeamHandler{teamService: teamService, ownershipService: ownershipService, authService: authService}
}

// ListTeams returns all teams
func (h *TeamHandler) ListTeams(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	teams, err := h.teamService.ListTeams(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, teams)
}

// GetTeam returns a single team by ID
func (h *TeamHandler) GetTeam(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	id := c.Param("id")
	team, err := h.teamService.GetTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if team == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"value": team})
}

// CreateTeam creates a new team (super_admin only)
func (h *TeamHandler) CreateTeam(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var team models.Team
	if err := c.ShouldBindJSON(&team); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if strings.TrimSpace(team.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Team name is required"})
		return
	}

	if err := h.teamService.CreateTeam(c.Request.Context(), &team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, team)
}

// UpdateTeam renames a team or edits its description (super_admin only).
//
// Membership is deliberately not editable here. A user's team is stored per
// (user, instance) in user_instances rather than on the Team record — the same
// user can sit in different teams on staging and prod — so it is managed from
// the Users screen, which has the instance context this one does not.
func (h *TeamHandler) UpdateTeam(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	id := c.Param("id")

	// UpdateTeam in the service layer is a blind write, so an unknown id would
	// silently create a team rather than report that there is nothing to edit.
	existing, err := h.teamService.GetTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	var body models.Team
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if strings.TrimSpace(body.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Team name is required"})
		return
	}

	// The id comes from the URL and never from the payload: a body carrying a
	// different id would otherwise write this team's fields over another one.
	updated := &models.Team{
		ID:          existing.ID,
		Name:        body.Name,
		Description: body.Description,
	}

	if err := h.teamService.UpdateTeam(c.Request.Context(), updated); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// Machine-readable codes on a refused delete, so the page can say why in the
// reader's language rather than "Failed to delete team".
const (
	teamOwnsResourcesCode = "team_owns_resources"
	teamHasMembersCode    = "team_has_members"
)

// teamDeleteRefused is the answer to a delete that may not happen yet.
type teamDeleteRefused struct {
	Error string `json:"error"`
	Code  string `json:"code"`
	// Count is how many of what stands in the way: resources or assignments.
	Count int `json:"count"`
}

// teamDeleteRefusal says why a team may not be deleted yet, or nil when it may.
//
// While it owns resources: they would be left naming a team that is gone, and
// invisible to everyone but an admin.
//
// And while an assignment names it. For a developer or a viewer the teams are
// the access boundary, and a delete that did not look at them left the
// assignment naming a team that no longer exists: with that one team, an
// account that sees nothing and creates for a team no screen can show; with
// several (#301), one that has to name a team to create while its header
// offers a single one (#375). The operator moves the people, then deletes
// the team - the same order as for what it owns.
func teamDeleteRefusal(owned, members int) *teamDeleteRefused {
	switch {
	case owned > 0:
		return &teamDeleteRefused{
			Error: fmt.Sprintf("Cannot delete team: it owns %d resources. Reassign or delete them first.", owned),
			Code:  teamOwnsResourcesCode,
			Count: owned,
		}
	case members > 0:
		return &teamDeleteRefused{
			Error: fmt.Sprintf("Cannot delete team: %d user assignments still name it. Move those users to another team first.", members),
			Code:  teamHasMembersCode,
			Count: members,
		}
	}
	return nil
}

// DeleteTeam removes a team (super_admin only), blocked while the team owns
// resources or an assignment names it.
func (h *TeamHandler) DeleteTeam(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	id := c.Param("id")

	owned, err := h.ownershipService.CountByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// The assignments that name it, on any instance. A read that fails
	// refuses the delete: "no members" is not something to assume.
	members, err := h.authService.ListUsersByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if refusal := teamDeleteRefusal(owned, len(members)); refusal != nil {
		c.JSON(http.StatusConflict, refusal)
		return
	}

	if err := h.teamService.DeleteTeam(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetTeamMembers returns all users assigned to a team across instances
func (h *TeamHandler) GetTeamMembers(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	id := c.Param("id")
	members, err := h.authService.ListUsersByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"list": members, "total": len(members)})
}
