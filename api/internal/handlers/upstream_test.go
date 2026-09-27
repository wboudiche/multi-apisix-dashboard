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

// callTestUpstream calls the handler. Who may ask is checked before it, by
// middleware.RequireResourcePermission on the route (#307).
func callTestUpstream(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/test-upstream", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	NewUpstreamHandler().TestConnection(c)
	return w
}

func postTestUpstream(t *testing.T, body string) TestUpstreamResponse {
	t.Helper()
	w := callTestUpstream(t, body)
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
		"localhost":  {net.ParseIP("127.0.0.1")},
		"httpbin":    {net.ParseIP("172.19.0.6")},
		"nat64-host": {net.ParseIP("64:ff9b::a00:1")},
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
		// The same internal addresses written as an IPv6 address that carries
		// one, which the guard used to read as public IPv6 (#308).
		"64:ff9b::a00:1",   // NAT64: 10.0.0.1
		"[64:ff9b::a00:1]", // and bracketed, as APISIX takes it
		"2002:c0a8:1::",    // 6to4: 192.168.0.1
		"::10.0.0.1",       // IPv4-compatible
		"::ffff:10.0.0.1",  // IPv4-mapped
		"0.0.0.1",          // "this network"
		"198.18.0.1",       // benchmarking
		"nat64-host",       // a name resolving to one of them
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

func TestUpstreamTestCapsTheNodesPerRequest(t *testing.T) {
	fakeResolver(t, nil)
	body := func(n int) string {
		nodes := make([]string, n)
		for i := range nodes {
			nodes[i] = fmt.Sprintf(`{"host":"10.0.0.%d","port":80}`, i%250+1)
		}
		return `{"nodes":[` + strings.Join(nodes, ",") + `]}`
	}

	if w := callTestUpstream(t, body(maxTestNodes)); w.Code != http.StatusOK {
		t.Errorf("%d nodes: status %d, want %d", maxTestNodes, w.Code, http.StatusOK)
	}
	if w := callTestUpstream(t, body(maxTestNodes+1)); w.Code != http.StatusBadRequest {
		t.Errorf("%d nodes: status %d, want %d", maxTestNodes+1, w.Code, http.StatusBadRequest)
	}
}

// The body is capped before it is decoded, not after.
func TestUpstreamTestCapsTheBody(t *testing.T) {
	fakeResolver(t, nil)
	pad := strings.Repeat(" ", maxTestBodyBytes)
	w := callTestUpstream(t, `{"nodes":[{"host":"10.0.0.1","port":80}]`+pad+`}`)
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

// Every form an internal address can take, and the public ones that must still
// get through. An address in a transition family carries an IPv4 address
// inside an IPv6 one: on a host with NAT64, 64:ff9b::a00:1 is 10.0.0.1, and
// the guard read it as a public IPv6 address (#308).
func TestIsBlockedAddr(t *testing.T) {
	for _, tt := range []struct {
		addr    string
		blocked bool
		why     string
	}{
		// Already covered, kept so a rewrite of the list cannot lose them.
		{"10.0.0.1", true, "RFC 1918"},
		{"172.16.0.1", true, "RFC 1918"},
		{"192.168.0.1", true, "RFC 1918"},
		{"100.64.0.1", true, "CGNAT"},
		{"127.0.0.1", true, "loopback"},
		{"169.254.169.254", true, "link-local, cloud metadata"},
		{"224.0.0.1", true, "multicast"},
		{"fd00::1", true, "IPv6 unique-local"},
		{"fe80::1", true, "IPv6 link-local"},
		{"::1", true, "IPv6 loopback"},
		{"::", true, "unspecified"},

		// Added by #308.
		{"0.0.0.1", true, "this network"},
		{"0.255.255.255", true, "this network"},
		{"192.0.0.1", true, "IETF protocol assignments"},
		{"198.18.0.1", true, "benchmarking"},
		{"198.19.255.255", true, "benchmarking"},
		{"240.0.0.1", true, "reserved"},
		{"255.255.255.255", true, "broadcast"},
		{"64:ff9b::a00:1", true, "NAT64 carrying 10.0.0.1"},
		{"64:ff9b::c0a8:1", true, "NAT64 carrying 192.168.0.1"},
		{"64:ff9b:1::a00:1", true, "NAT64 local-use prefix"},
		{"2002:c0a8:1::", true, "6to4 carrying 192.168.0.1"},
		{"2002:cb00:710a::", true, "6to4: the prefix is refused as a range"},
		{"::10.0.0.1", true, "IPv4-compatible carrying 10.0.0.1"},
		{"::ffff:10.0.0.1", true, "IPv4-mapped carrying 10.0.0.1"},
		{"2001::1", true, "Teredo"},
		// Refused although the address it carries is public: the whole
		// transition prefix is refused, rather than trusting a host's NAT64 to
		// send it where it says.
		{"64:ff9b::cb00:710a", true, "NAT64 carrying 203.0.113.10"},

		// Public, and must stay dialable. The documentation ranges stand in
		// for a real upstream in the tests above.
		{"8.8.8.8", false, "public IPv4"},
		{"203.0.113.10", false, "documentation IPv4, the tests' public node"},
		{"198.51.100.1", false, "documentation IPv4"},
		{"192.0.2.1", false, "documentation IPv4"},
		{"2001:db8::1", false, "documentation IPv6"},
		{"2606:4700::1111", false, "public IPv6"},
	} {
		ip := net.ParseIP(tt.addr)
		if ip == nil {
			t.Errorf("%s: not an address", tt.addr)
			continue
		}
		if got := isBlockedAddr(ip); got != tt.blocked {
			t.Errorf("isBlockedAddr(%s) = %v, want %v (%s)", tt.addr, got, tt.blocked, tt.why)
		}
	}
	if !isBlockedAddr(nil) {
		t.Error("isBlockedAddr(nil) = false, want true: nothing is an address until it is one")
	}
}

// The address a transition family carries, read out of it. nil for everything
// else, including an IPv4 address, which is what stops the check recurring.
func TestEmbeddedIPv4(t *testing.T) {
	for _, tt := range []struct{ addr, want string }{
		{"64:ff9b::a00:1", "10.0.0.1"},
		{"64:ff9b::cb00:710a", "203.0.113.10"},
		{"2002:c0a8:1::", "192.168.0.1"},
		{"2002:cb00:710a::", "203.0.113.10"},
		{"::10.0.0.1", "10.0.0.1"},
		{"10.0.0.1", ""},
		{"::ffff:10.0.0.1", ""}, // already IPv4 to every helper here
		{"2001:db8::1", ""},
		{"fd00::1", ""},
	} {
		got := embeddedIPv4(net.ParseIP(tt.addr))
		if tt.want == "" {
			if got != nil {
				t.Errorf("embeddedIPv4(%s) = %v, want none", tt.addr, got)
			}
			continue
		}
		if got == nil || !got.Equal(net.ParseIP(tt.want)) {
			t.Errorf("embeddedIPv4(%s) = %v, want %s", tt.addr, got, tt.want)
		}
	}
}
