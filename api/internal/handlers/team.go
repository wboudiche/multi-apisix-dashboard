package handlers

import (
	"fmt"
	"net/http"

	"github.com/apache/apisix-dashboard/api/internal/middleware"
	"github.com/apache/apisix-dashboard/api/internal/models"
	"github.com/apache/apisix-dashboard/api/internal/services"

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
	teams, err := h.teamService.ListTeams(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, teams)
}

// GetTeam returns a single team by ID
func (h *TeamHandler) GetTeam(c *gin.Context) {
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

	if err := h.teamService.CreateTeam(c.Request.Context(), &team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, team)
}

// DeleteTeam removes a team (super_admin only), blocked if team owns resources
func (h *TeamHandler) DeleteTeam(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	id := c.Param("id")

	count, err := h.ownershipService.CountByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("Cannot delete team: it owns %d resources. Reassign or delete them first.", count),
		})
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
	id := c.Param("id")
	members, err := h.authService.ListUsersByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"list": members, "total": len(members)})
}
