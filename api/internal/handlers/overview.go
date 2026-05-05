package handlers

import (
	"net/http"

	"github.com/apache/apisix-dashboard/api/internal/middleware"
	"github.com/apache/apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

type OverviewHandler struct {
	overviewService *services.OverviewService
}

func NewOverviewHandler(overviewService *services.OverviewService) *OverviewHandler {
	return &OverviewHandler{
		overviewService: overviewService,
	}
}

// GetOverview returns dashboard summary data
func (h *OverviewHandler) GetOverview(c *gin.Context) {
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	teamID := middleware.GetTeamID(c)

	forceRefresh := c.Query("refresh") == "true"

	var data interface{}
	var err error

	if forceRefresh {
		data, err = h.overviewService.RefreshOverview(c.Request.Context(), userID, role, teamID)
	} else {
		data, err = h.overviewService.GetOverview(c.Request.Context(), userID, role, teamID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, data)
}
