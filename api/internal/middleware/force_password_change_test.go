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

package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// newForceGateRouter builds a minimal router that mimics main.go's protected
// group: a fake auth layer that stamps the user ID, then the force-change
// gate, then a few representative routes.
func newForceGateRouter(lookup MustChangeLookup) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(UserIDKey, "user-1")
		c.Next()
	})
	r.Use(ForcePasswordChange(lookup))

	ok := func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) }
	r.GET("/api/v1/overview", ok)
	r.GET("/api/v1/user", ok)
	r.POST("/api/v1/user/password", ok)
	r.POST("/api/v1/logout", ok)
	r.GET("/api/v1/settings/password-policy", ok)
	return r
}

func doReq(t *testing.T, r *gin.Engine, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestForcePasswordChangeBlocksProtectedRoutes(t *testing.T) {
	r := newForceGateRouter(func(ctx context.Context, userID string) (bool, error) {
		return true, nil
	})

	w := doReq(t, r, http.MethodGet, "/api/v1/overview")
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for gated route, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "password_change_required") {
		t.Fatalf("expected password_change_required code in body, got %s", w.Body.String())
	}
}

func TestForcePasswordChangeAllowsExemptRoutes(t *testing.T) {
	r := newForceGateRouter(func(ctx context.Context, userID string) (bool, error) {
		return true, nil
	})

	exempt := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/user"},
		{http.MethodPost, "/api/v1/user/password"},
		{http.MethodPost, "/api/v1/logout"},
		{http.MethodGet, "/api/v1/settings/password-policy"},
	}
	for _, e := range exempt {
		if w := doReq(t, r, e.method, e.path); w.Code != http.StatusOK {
			t.Errorf("expected 200 for exempt %s %s, got %d", e.method, e.path, w.Code)
		}
	}
}

func TestForcePasswordChangePassesWhenFlagUnset(t *testing.T) {
	r := newForceGateRouter(func(ctx context.Context, userID string) (bool, error) {
		return false, nil
	})

	if w := doReq(t, r, http.MethodGet, "/api/v1/overview"); w.Code != http.StatusOK {
		t.Fatalf("expected 200 when flag unset, got %d", w.Code)
	}
}

func TestForcePasswordChangeFailsOpenOnLookupError(t *testing.T) {
	// The gate is a UX enforcement layer, not the auth boundary: if the user
	// record cannot be read, downstream handlers hitting the same store will
	// surface the real error, so the gate lets the request through.
	r := newForceGateRouter(func(ctx context.Context, userID string) (bool, error) {
		return false, errors.New("etcd down")
	})

	if w := doReq(t, r, http.MethodGet, "/api/v1/overview"); w.Code != http.StatusOK {
		t.Fatalf("expected 200 on lookup error (fail-open), got %d", w.Code)
	}
}
