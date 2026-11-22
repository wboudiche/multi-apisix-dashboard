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

package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

func idpCtx(method, role string, ui *models.UserInstance, pathID, headerID string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/", nil)
	if headerID != "" {
		c.Request.Header.Set("X-Instance-ID", headerID)
	}
	c.Params = gin.Params{{Key: "id", Value: pathID}}
	c.Set(middleware.RoleKey, role)
	if ui != nil {
		c.Set(middleware.UserInstanceKey, ui)
	}
	return c, w
}

func TestPublicIdPNeverCarriesSecret(t *testing.T) {
	p := &models.IdentityProvider{ID: "k1", Name: "KC", AdminClientSecret: "s3cr3t", BaseURL: "https://sso"}
	b, err := json.Marshal(publicIdP(p))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "s3cr3t") || strings.Contains(string(b), "admin_client_secret") {
		t.Fatalf("secret leaked: %s", b)
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if m["has_secret"] != true {
		t.Fatalf("has_secret = %v", m["has_secret"])
	}
	if publicIdP(&models.IdentityProvider{}).HasSecret {
		t.Fatal("has_secret true without a secret")
	}
}

func TestIdPEndpointsRefuseNonSuperAdmin(t *testing.T) {
	h := &IdPHandler{idps: services.NewIdPService(nil)}
	ui := &models.UserInstance{Role: models.RoleInstanceAdmin}
	for name, fn := range map[string]gin.HandlerFunc{
		"list":   h.ListIdPs,
		"create": h.CreateIdP,
		"get":    h.GetIdP,
		"update": h.UpdateIdP,
		"delete": h.DeleteIdP,
		"test":   h.TestIdP,
	} {
		c, w := idpCtx(http.MethodGet, models.RoleInstanceAdmin, ui, "k1", "i1")
		fn(c)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: status %d, want 403", name, w.Code)
		}
	}
}

func TestLinkedIdPsRefuseViewer(t *testing.T) {
	h := &IdPHandler{idps: services.NewIdPService(nil)}
	viewer := &models.UserInstance{Role: models.RoleViewer, TeamIDs: []string{"t1"}}
	c, w := idpCtx(http.MethodGet, models.RoleViewer, viewer, "i1", "i1")
	h.ListLinkedIdPs(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("viewer: status %d, want 403", w.Code)
	}
	// a team viewer under a developer assignment is a viewer too
	mixed := &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{"t1"}, TeamRoles: map[string]string{"t1": models.RoleViewer}}
	c, w = idpCtx(http.MethodGet, models.RoleViewer, mixed, "i1", "i1")
	h.ListLinkedIdPs(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("team viewer: status %d, want 403", w.Code)
	}
}

func TestRequirePathInstanceMismatch(t *testing.T) {
	c, w := idpCtx(http.MethodGet, models.RoleDeveloper, nil, "i1", "i2")
	if _, ok := requirePathInstance(c); ok {
		t.Fatal("mismatch accepted")
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", w.Code)
	}
	c, _ = idpCtx(http.MethodGet, models.RoleDeveloper, nil, "i1", "i1")
	if id, ok := requirePathInstance(c); !ok || id != "i1" {
		t.Fatal("match refused")
	}
}
