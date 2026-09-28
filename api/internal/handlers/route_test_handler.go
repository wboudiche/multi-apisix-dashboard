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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"

	"github.com/gin-gonic/gin"
)

// ownerReader reads which team owns a resource. *services.OwnershipService
// satisfies it; a test does not need etcd to, as middleware.InstanceReader
// already does for the permission check.
type ownerReader interface {
	GetOwner(ctx context.Context, instanceID, resourceType, resourceID string) (string, error)
}

type RouteTestHandler struct {
	ownershipService ownerReader
}

// The instance comes from middleware.RequireResourcePermission, on the route.
// The ownership store is read here, to answer whose route is being tested
// (#311).
func NewRouteTestHandler(ownershipService ownerReader) *RouteTestHandler {
	return &RouteTestHandler{ownershipService: ownershipService}
}

type TestRouteRequest struct {
	// RouteID names the route being tested. Required: the endpoint used to take
	// any path and send it, so a developer in one team could send a DELETE to a
	// route of another team's that they cannot even see in the list (#311).
	RouteID string            `json:"route_id" binding:"required"`
	Method  string            `json:"method" binding:"required"`
	Path    string            `json:"path" binding:"required"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	// Query is a map, as the drawer sends it. It was a string, which no client
	// ever sent: a test carrying a parameter was refused where it was bound,
	// before it could reach the gateway (#256).
	Query map[string]string `json:"query"`
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
	// The instance RequireResourcePermission resolved on the route: read
	// there rather than fetched again, so the two cannot disagree on which
	// instance a request targets, nor on whether it may be used at all.
	instance := middleware.GetInstance(c)
	if instance == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Instance not resolved"})
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
	parsed, perr := url.Parse(strings.TrimRight(instance.GatewayURL, "/") + req.Path)
	if perr != nil || parsed.Scheme != base.Scheme || parsed.Host != base.Host || parsed.User != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
		return
	}
	// A fragment is never sent, and a path carrying one would quietly drop the
	// parameters with it.
	if parsed.Fragment != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path must not carry a fragment"})
		return
	}
	// Whose route this is, and whether the path belongs to it. The gateway is
	// the data plane and would answer anybody who can reach it - but it is the
	// dashboard that sits on its network, and an account that may write routes
	// on this instance is not thereby entitled to send traffic at another
	// team's (#311).
	isAdmin, teamID := callerTeamScope(c)
	if !isAdmin {
		owner, err := h.ownershipService.GetOwner(c.Request.Context(), instance.ID, "routes", req.RouteID)
		if err != nil {
			// Fail closed: a route whose owner cannot be read is not a route to
			// send a request to.
			c.JSON(http.StatusBadGateway, gin.H{"error": couldNotVerifyMsg})
			return
		}
		if !nonAdminMayAccess(owner, teamID) {
			c.JSON(http.StatusForbidden, gin.H{"error": otherTeamMsg})
			return
		}
	}

	route, err := h.readRoute(c.Request.Context(), instance, req.RouteID)
	if err != nil {
		if errors.Is(err, errRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "No such route on this instance"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": couldNotVerifyMsg})
		return
	}
	// The path is checked after parsing, so a query string travels with the
	// request without taking part in the match.
	if !routeMatchesPath(route, parsed.Path) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "The path is not one this route matches",
		})
		return
	}

	log.Printf("[route-test] user=%s instance=%s route=%s team=%s admin=%t %s %s",
		middleware.GetUserID(c), instance.ID, req.RouteID, teamID, isAdmin, req.Method, parsed.Path)

	// Merged into whatever the path already asks for, rather than appended
	// behind a second "?", which left the last parameter of the path holding
	// the rest of the query and the gateway matching nothing (#256).
	parsed.RawQuery = queryFor(parsed.Query(), req.Query)
	targetURL := parsed.String()

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
		// Within the dashboard's ceiling on outbound connections, like the
		// connection test and the WSDL fetch: this dials the gateway from the
		// dashboard's own address (#330).
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			DialContext:         guardedDial,
			TLSHandshakeTimeout: 5 * time.Second,
			DisableKeepAlives:   true,
		},
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

// queryFor is the query string of a test: what its path already carries, plus
// the parameters it was given, each escaped so a value cannot reshape the URL
// it lands in. A parameter replaces one of the same name in the path.
func queryFor(existing url.Values, query map[string]string) string {
	for key, value := range query {
		if key == "" {
			continue
		}
		existing.Set(key, value)
	}
	return existing.Encode()
}

// errRouteNotFound says the instance has no such route, which is a 404 for the
// caller rather than a failure to check.
var errRouteNotFound = errors.New("route not found")

// apisixRoute is the part of a route this handler reads. APISIX answers a
// detail read as {"value": {...}}, and has answered it flat in the past, so
// both shapes are accepted - a route that decodes to neither would otherwise
// read as one that matches nothing.
type apisixRoute struct {
	URI  string   `json:"uri"`
	URIs []string `json:"uris"`
}

func (h *RouteTestHandler) readRoute(ctx context.Context, instance *models.Instance, routeID string) (apisixRoute, error) {
	target := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin/routes/" + url.PathEscape(routeID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return apisixRoute{}, err
	}
	if instance.AdminKey != "" {
		req.Header.Set("X-API-Key", instance.AdminKey)
	}

	resp, err := proxyClient.Do(req)
	if err != nil {
		return apisixRoute{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return apisixRoute{}, errRouteNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return apisixRoute{}, fmt.Errorf("admin API returned status %d", resp.StatusCode)
	}

	var body struct {
		Value *apisixRoute `json:"value"`
		apisixRoute
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return apisixRoute{}, err
	}
	if body.Value != nil {
		return *body.Value, nil
	}
	return body.apisixRoute, nil
}

// routeMatchesPath reports whether path is one the route accepts.
//
// It is APISIX's uri form, not APISIX's matching: a route also selects on host,
// method, vars and priority, so a request can still reach a route this did not
// name. What it does close is the case the endpoint was open to - naming one
// route and sending a request at another - and it is deliberately strict about
// nothing else.
func routeMatchesPath(route apisixRoute, path string) bool {
	for _, uri := range append([]string{route.URI}, route.URIs...) {
		if uri == "" {
			continue
		}
		if prefix, wild := strings.CutSuffix(uri, "*"); wild {
			if strings.HasPrefix(path, prefix) {
				return true
			}
			continue
		}
		if path == uri {
			return true
		}
	}
	return false
}
