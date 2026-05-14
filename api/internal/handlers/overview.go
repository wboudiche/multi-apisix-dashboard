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
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

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
