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
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	lookupIP = func(_ context.Context, host string) ([]net.IP, error) {
		if ips, ok := names[host]; ok {
			return ips, nil
		}
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	t.Cleanup(func() { lookupIP = orig })
}

// fakeDial connects to the addresses in up, refuses every other one, and
// records what was dialed.
func fakeDial(t *testing.T, up ...string) *[]string {
	t.Helper()
	orig := dialContext
	var dialed []string
	var mu sync.Mutex
	dialContext = func(_ context.Context, _, addr string) (net.Conn, error) {
		mu.Lock()
		dialed = append(dialed, addr)
		mu.Unlock()
		for _, a := range up {
			if a == addr {
				client, server := net.Pipe()
				server.Close()
				return client, nil
			}
		}
		return nil, errors.New("connection refused")
	}
	t.Cleanup(func() { dialContext = orig })
	return &dialed
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
	dialed := fakeDial(t)
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
	if len(*dialed) != 0 {
		t.Errorf("dialed %v", *dialed)
	}
}

// The guard unbrackets an IPv6 literal itself, so that every caller gets a
// public one through rather than refused as a name that does not resolve.
func TestResolveAllowedIPTakesABracketedIPv6Literal(t *testing.T) {
	fakeResolver(t, nil)
	ip, err := resolveAllowedIP(context.Background(), "[2001:db8::1]")
	if err != nil || !ip.Equal(net.ParseIP("2001:db8::1")) {
		t.Errorf("got %v, %v; want 2001:db8::1", ip, err)
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

// A name the dashboard's network resolves to an internal address, and a name
// that does not resolve at all, must get the same answer: two answers would
// list the internal names on that network - etcd beside the dashboard, say -
// which no route on the gateway may ever reach.
func TestUpstreamTestDoesNotTellAnInternalNameFromAMissingOne(t *testing.T) {
	fakeResolver(t, map[string][]net.IP{"etcd": {net.ParseIP("172.19.0.2")}})
	internal := postTestUpstream(t, oneNode("etcd", 2379)).Results[0]
	missing := postTestUpstream(t, oneNode("no-such-host.invalid", 2379)).Results[0]

	if internal.Status != NodeNotAllowed || missing.Status != NodeNotAllowed {
		t.Errorf("statuses %q and %q, want %q for both", internal.Status, missing.Status, NodeNotAllowed)
	}
	if internal.Message != missing.Message {
		t.Errorf("messages differ: %q, %q", internal.Message, missing.Message)
	}
}

// A public address is dialed, and reads as it answered.
func TestUpstreamTestDialsAPublicAddress(t *testing.T) {
	fakeResolver(t, map[string][]net.IP{
		"up.example":   {net.ParseIP("203.0.113.10")},
		"down.example": {net.ParseIP("203.0.113.11")},
	})
	dialed := fakeDial(t, "203.0.113.10:80")

	resp := postTestUpstream(t, `{"nodes":[{"host":"up.example","port":80},{"host":"down.example","port":80}]}`)
	if got := resp.Results[0].Status; got != NodeConnected {
		t.Errorf("up.example: status %q, want %q", got, NodeConnected)
	}
	if got := resp.Results[1].Status; got != NodeFailed {
		t.Errorf("down.example: status %q, want %q", got, NodeFailed)
	}
	if resp.Status != StatusPartial {
		t.Errorf("overall %q, want %q", resp.Status, StatusPartial)
	}
	if len(*dialed) != 2 {
		t.Errorf("dialed %v, want both nodes", *dialed)
	}
}

// The test has the dashboard open connections on the caller's behalf, so it is
// for those who configure upstreams: the callers who can write upstreams on
// the instance.
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
	body := func(n int) string {
		nodes := make([]string, n)
		for i := range nodes {
			nodes[i] = fmt.Sprintf(`{"host":"10.0.0.%d","port":80}`, i%250+1)
		}
		return `{"nodes":[` + strings.Join(nodes, ",") + `]}`
	}

	if w := callTestUpstream(t, models.RoleSuperAdmin, nil, body(maxTestNodes)); w.Code != http.StatusOK {
		t.Errorf("%d nodes: status %d, want %d", maxTestNodes, w.Code, http.StatusOK)
	}
	if w := callTestUpstream(t, models.RoleSuperAdmin, nil, body(maxTestNodes+1)); w.Code != http.StatusBadRequest {
		t.Errorf("%d nodes: status %d, want %d", maxTestNodes+1, w.Code, http.StatusBadRequest)
	}
}

// The body is capped before it is decoded, not after.
func TestUpstreamTestCapsTheBody(t *testing.T) {
	fakeResolver(t, nil)
	pad := strings.Repeat(" ", maxTestBodyBytes)
	w := callTestUpstream(t, models.RoleSuperAdmin, nil, `{"nodes":[{"host":"10.0.0.1","port":80}]`+pad+`}`)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status %d, want %d (%s)", w.Code, http.StatusRequestEntityTooLarge, w.Body.String())
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
