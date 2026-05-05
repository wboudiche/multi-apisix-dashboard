package handlers

import (
	"net/http"

	"github.com/apache/apisix-dashboard/api/internal/middleware"
	"github.com/apache/apisix-dashboard/api/internal/models"

	"github.com/gin-gonic/gin"
)

// RoleHandler handles role-related requests
type RoleHandler struct{}

func NewRoleHandler() *RoleHandler {
	return &RoleHandler{}
}

// ListRoles returns all available roles and their permissions
func (h *RoleHandler) ListRoles(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	roles := []gin.H{
		{
			"name":        models.RoleSuperAdmin,
			"description": "Full access to all resources",
			"permissions": models.RolePermissions[models.RoleSuperAdmin],
		},
		{
			"name":        models.RoleInstanceAdmin,
			"description": "Full access to assigned instances",
			"permissions": models.RolePermissions[models.RoleInstanceAdmin],
		},
		{
			"name":        models.RoleDeveloper,
			"description": "Read-write access to assigned instances",
			"permissions": models.RolePermissions[models.RoleDeveloper],
		},
		{
			"name":        models.RoleViewer,
			"description": "Read-only access to assigned instances",
			"permissions": models.RolePermissions[models.RoleViewer],
		},
	}

	c.JSON(http.StatusOK, roles)
}
