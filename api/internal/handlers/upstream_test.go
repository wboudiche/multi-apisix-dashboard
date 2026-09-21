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
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// fakeResolver answers lookups from names instead of the machine's resolver,
// and fails every other name as not found.
func fakeResolver(t *testing.T, names map[string][]net.IP) {
	t.Helper()
	orig := lookupIP
	lookupIP = func(host string) ([]net.IP, error) {
		if ips, ok := names[host]; ok {
			return ips, nil
		}
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	t.Cleanup(func() { lookupIP = orig })
}

// callTestUpstream calls the handler as a caller with the given global role
// and, when ui is not nil, that assignment on the instance - what
// RBACMiddleware leaves on the context.
func callTestUpstream(t *testing.T, role string, ui *models.UserInstance, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/test-upstream", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(middleware.RoleKey, role)
	if ui != nil {
		c.Set(middleware.UserInstanceKey, ui)
	}

	NewUpstreamHandler().TestConnection(c)
	return w
}

func postTestUpstream(t *testing.T, body string) TestUpstreamResponse {
	t.Helper()
	w := callTestUpstream(t, models.RoleSuperAdmin, nil, body)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", w.Code, w.Body.String())
	}
	var resp TestUpstreamResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return resp
}

func oneNode(host string, port int) string {
	return fmt.Sprintf(`{"nodes":[{"host":%q,"port":%d}]}`, host, port)
}

// An internal address is refused before any dial, so the node was never
// tried. It used to come back as "failed", which the form shows as a node that
// is down - for what is, in a Docker or Kubernetes deployment, nearly every
// upstream there is (#304).
func TestUpstreamTestSaysAnInternalAddressWasNotTested(t *testing.T) {
	fakeResolver(t, map[string][]net.IP{
		"localhost": {net.ParseIP("127.0.0.1")},
		"httpbin":   {net.ParseIP("172.19.0.6")},
	})
	for _, host := range []string{
		"10.1.2.3",
		"172.19.0.6", // a Docker bridge network
		"192.168.1.10",
		"100.64.0.1",
		"127.0.0.1",
		"169.254.169.254", // cloud metadata
		"::1",
		"fe80::1",
		"fd00::1",
		"[fd00::1]", // APISIX takes an IPv6 node in brackets
		"localhost",
		"httpbin", // a name, resolved before the check
	} {
		resp := postTestUpstream(t, oneNode(host, 8080))
		if got := resp.Results[0].Status; got != NodeNotAllowed {
			t.Errorf("%s: status %q, want %q", host, got, NodeNotAllowed)
		}
		if resp.Results[0].Host != host {
			t.Errorf("%s: result names the node %q", host, resp.Results[0].Host)
		}
	}
}

// Saying why is all that changed: the guard must still keep the dashboard from
// connecting to an internal address.
func TestUpstreamTestStillDoesNotDialAnInternalAddress(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	accepted := make(chan struct{}, 1)
	go func() {
		if conn, err := ln.Accept(); err == nil {
			conn.Close()
			accepted <- struct{}{}
		}
	}()

	resp := postTestUpstream(t, oneNode("127.0.0.1", port))
	if got := resp.Results[0].Status; got != NodeNotAllowed {
		t.Errorf("status %q, want %q", got, NodeNotAllowed)
	}

	select {
	case <-accepted:
		t.Fatal("the dashboard connected to a loopback address")
	case <-time.After(200 * time.Millisecond):
	}
}

// A name that does not resolve was tried, and failed: it is not an internal
// address, and must not be reported as one.
func TestUpstreamTestReportsAnUnresolvableNameAsFailed(t *testing.T) {
	fakeResolver(t, nil)
	resp := postTestUpstream(t, oneNode("no-such-host.invalid", 80))
	if got := resp.Results[0].Status; got != NodeFailed {
		t.Errorf("status %q, want %q", got, NodeFailed)
	}
}

// The answer tells whether a name resolves to an internal address, so it is
// only for those who could point a route at that address anyway: the callers
// who can write upstreams on the instance.
func TestUpstreamTestIsForThoseWhoCanWriteUpstreams(t *testing.T) {
	fakeResolver(t, nil)
	assigned := func(role string) *models.UserInstance {
		return &models.UserInstance{UserID: "u1", InstanceID: "i1", Role: role}
	}
	for _, tc := range []struct {
		name string
		role string
		ui   *models.UserInstance
		want int
	}{
		{"super admin", models.RoleSuperAdmin, nil, http.StatusOK},
		{"instance admin", "", assigned(models.RoleInstanceAdmin), http.StatusOK},
		{"developer", "", assigned(models.RoleDeveloper), http.StatusOK},
		{"viewer", "", assigned(models.RoleViewer), http.StatusForbidden},
		// RBACMiddleware lets a request that names no instance through.
		{"no instance", "", nil, http.StatusForbidden},
	} {
		w := callTestUpstream(t, tc.role, tc.ui, oneNode("10.0.0.1", 80))
		if w.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", tc.name, w.Code, tc.want, w.Body.String())
		}
	}
}

func TestUpstreamTestCapsTheNodesPerRequest(t *testing.T) {
	fakeResolver(t, nil)
	nodes := make([]string, maxTestNodes+1)
	for i := range nodes {
		nodes[i] = fmt.Sprintf(`{"host":"10.0.0.%d","port":80}`, i%250+1)
	}
	body := `{"nodes":[` + strings.Join(nodes, ",") + `]}`

	w := callTestUpstream(t, models.RoleSuperAdmin, nil, body)
	if w.Code != http.StatusBadRequest {
		t.Errorf("%d nodes: status %d, want %d", len(nodes), w.Code, http.StatusBadRequest)
	}
}

func TestUpstreamTestOverallStatus(t *testing.T) {
	r := func(statuses ...string) []NodeTestResult {
		out := make([]NodeTestResult, len(statuses))
		for i, s := range statuses {
			out[i] = NodeTestResult{Status: s}
		}
		return out
	}
	for _, tc := range []struct {
		name    string
		results []NodeTestResult
		want    string
	}{
		{"all connected", r(NodeConnected, NodeConnected), NodeConnected},
		{"some connected", r(NodeConnected, NodeFailed), StatusPartial},
		{"some connected, one not tested", r(NodeConnected, NodeNotAllowed), StatusPartial},
		// It used to answer "partial" here, with not one node reached.
		{"none connected", r(NodeFailed, NodeFailed), NodeFailed},
		{"none connected, one not tested", r(NodeFailed, NodeNotAllowed), NodeFailed},
		// Nothing was tried, so nothing is known to be down.
		{"none tested", r(NodeNotAllowed, NodeNotAllowed), NodeNotAllowed},
		{"no nodes", r(), NodeFailed},
	} {
		if got := overallStatus(tc.results); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
}
