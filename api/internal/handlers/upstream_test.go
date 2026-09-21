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
)

func postTestUpstream(t *testing.T, body string) TestUpstreamResponse {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/test-upstream", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	NewUpstreamHandler().TestConnection(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", w.Code, w.Body.String())
	}
	var resp TestUpstreamResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return resp
}

// An internal address is refused before any dial, so the node was never
// tried. It used to come back as "failed", which the form shows as a node that
// is down - for what is, in a Docker or Kubernetes deployment, nearly every
// upstream there is (#304).
func TestUpstreamTestSaysAnInternalAddressWasNotTested(t *testing.T) {
	for _, host := range []string{
		"10.1.2.3",
		"172.19.0.6", // a Docker bridge network
		"192.168.1.10",
		"100.64.0.1",
		"127.0.0.1",
		"169.254.169.254", // cloud metadata
		"localhost",       // a name, resolved before the check
	} {
		resp := postTestUpstream(t, fmt.Sprintf(`{"nodes":[{"host":%q,"port":8080}]}`, host))
		if got := resp.Results[0].Status; got != NodeNotAllowed {
			t.Errorf("%s: status %q, want %q", host, got, NodeNotAllowed)
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

	resp := postTestUpstream(t, fmt.Sprintf(`{"nodes":[{"host":"127.0.0.1","port":%d}]}`, port))
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
	resp := postTestUpstream(t, `{"nodes":[{"host":"no-such-host.invalid","port":80}]}`)
	if got := resp.Results[0].Status; got != NodeFailed {
		t.Errorf("status %q, want %q", got, NodeFailed)
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
		{"some connected", r(NodeConnected, NodeFailed), "partial"},
		{"some connected, one not tested", r(NodeConnected, NodeNotAllowed), "partial"},
		// It used to answer "partial" here, with not one node reached.
		{"none connected", r(NodeFailed, NodeFailed), NodeFailed},
		{"none tested", r(NodeNotAllowed), NodeFailed},
	} {
		if got := overallStatus(tc.results); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
}
