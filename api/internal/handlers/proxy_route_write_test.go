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
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// routeWriteThroughProxy sends a super admin's route PUT through ProxyRequest
// to a fake Admin API, and returns the response and the bodies it received.
func routeWriteThroughProxy(t *testing.T, body string) (*httptest.ResponseRecorder, []string) {
	t.Helper()
	var received []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		received = append(received, r.Method+" "+r.URL.Path+" "+string(b))
		_, _ = w.Write([]byte(`{"key":"/apisix/routes/r1","value":{"id":"r1"}}`))
	}))
	t.Cleanup(srv.Close)

	h := NewProxyHandler(nil, nil, nil)
	h.getInstance = func(_ context.Context, id string) (*models.Instance, error) {
		return &models.Instance{ID: id, AdminAPIURL: srv.URL, AdminKey: "k", IsActive: true}, nil
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/apisix/admin/routes/r1", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "path", Value: "/routes/r1"}}
	c.Set(middleware.InstanceIDKey, "i1")
	c.Set(middleware.RoleKey, models.RoleSuperAdmin)
	h.ProxyRequest(c)
	return w, received
}

func TestProxyRouteWriteDropsTimestamps(t *testing.T) {
	w, received := routeWriteThroughProxy(t,
		`{"uri":"/x","create_time":1,"update_time":2,"priority":12345678901234567890}`)
	if w.Code != http.StatusOK || len(received) != 1 {
		t.Fatalf("status %d, upstream got %v", w.Code, received)
	}
	method, rest, _ := strings.Cut(received[0], " ")
	path, sent, _ := strings.Cut(rest, " ")
	if method != http.MethodPut || path != "/apisix/admin/routes/r1" {
		t.Fatalf("upstream got %s %s", method, path)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal([]byte(sent), &got); err != nil {
		t.Fatalf("upstream body %q: %v", sent, err)
	}
	if _, ok := got["create_time"]; ok {
		t.Errorf("create_time reached the gateway: %s", sent)
	}
	if _, ok := got["update_time"]; ok {
		t.Errorf("update_time reached the gateway: %s", sent)
	}
	if string(got["uri"]) != `"/x"` || string(got["priority"]) != "12345678901234567890" {
		t.Errorf("body changed beyond the timestamps: %s", sent)
	}
}

func TestProxyRouteWriteRefusesANonObjectBody(t *testing.T) {
	for _, body := range []string{`[1]`, `"x"`, `{"uri":"/x"} {}`, `{"uri":0x10}`} {
		w, received := routeWriteThroughProxy(t, body)
		if w.Code != http.StatusBadRequest || len(received) != 0 {
			t.Errorf("%s: status %d, upstream got %v", body, w.Code, received)
		}
	}
}
