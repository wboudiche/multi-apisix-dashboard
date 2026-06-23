/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package handlers

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

type RouteTestHandler struct {
	instanceService *services.InstanceService
}

func NewRouteTestHandler(instanceService *services.InstanceService) *RouteTestHandler {
	return &RouteTestHandler{
		instanceService: instanceService,
	}
}

type TestRouteRequest struct {
	Method  string            `json:"method" binding:"required"`
	Path    string            `json:"path" binding:"required"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	Query   string            `json:"query"`
}

type TestRouteResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"status_text"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	DurationMs int64             `json:"duration_ms"`
}

// TestRoute forwards a test request to the instance's gateway URL and returns the response
func (h *RouteTestHandler) TestRoute(c *gin.Context) {
	// Resolve the target instance through the single canonical helper so RBAC
	// and the handlers never disagree on which instance a request targets.
	instanceID := middleware.GetInstanceID(c)

	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	instance, err := h.instanceService.GetInstance(c.Request.Context(), instanceID)
	if err != nil || instance == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found"})
		return
	}

	if instance.GatewayURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance has no gateway_url configured"})
		return
	}

	var req TestRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Construct the target URL from the instance's GatewayURL. The user-supplied
	// path must be an absolute path and must not be able to redirect the request
	// to a different host/scheme (e.g. "@evil.com/" abusing URL userinfo parsing,
	// which would turn this into a readable SSRF against internal services).
	if !strings.HasPrefix(req.Path, "/") || strings.HasPrefix(req.Path, "//") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path must be an absolute path beginning with '/'"})
		return
	}
	base, err := url.Parse(strings.TrimRight(instance.GatewayURL, "/"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "instance gateway_url is invalid"})
		return
	}
	targetURL := strings.TrimRight(instance.GatewayURL, "/") + req.Path
	if parsed, perr := url.Parse(targetURL); perr != nil ||
		parsed.Scheme != base.Scheme || parsed.Host != base.Host || parsed.User != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
		return
	}
	if req.Query != "" {
		targetURL += "?" + req.Query
	}

	// Build the outgoing request
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = bytes.NewBufferString(req.Body)
	}

	proxyReq, err := http.NewRequest(req.Method, targetURL, bodyReader)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to create request: " + err.Error()})
		return
	}

	// Apply headers from the request
	for key, value := range req.Headers {
		proxyReq.Header.Set(key, value)
	}

	// Execute with a 10 second timeout
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	start := time.Now()
	resp, err := client.Do(proxyReq)
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Request failed: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to read response body: " + err.Error()})
		return
	}

	// Collect response headers
	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[key] = values[0]
		}
	}

	c.JSON(http.StatusOK, TestRouteResponse{
		Status:     resp.StatusCode,
		StatusText: http.StatusText(resp.StatusCode),
		Headers:    respHeaders,
		Body:       string(respBody),
		DurationMs: durationMs,
	})
}
