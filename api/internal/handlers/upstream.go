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
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func mustCIDR(cidr string) *net.IPNet {
	_, n, err := net.ParseCIDR(cidr)
	if err != nil {
		panic("handlers: bad CIDR " + cidr + ": " + err.Error())
	}
	return n
}

// The IPv6 forms that carry an IPv4 address inside them. NAT64, 6to4 and the
// two deprecated v4-in-v6 formats have fixed prefixes, so they are refused as
// ranges below; ISATAP has none - its prefix is whichever /64 the tunnel was
// given - so the only way to see what it carries is to read it out.
//
// On a host with NAT64, 64:ff9b::a00:1 is 10.0.0.1, and the guard read it as an
// ordinary public IPv6 address and dialed it (#308).
var (
	nat64WellKnown = mustCIDR("64:ff9b::/96")    // RFC 6052
	nat64LocalUse  = mustCIDR("64:ff9b:1::/48")  // RFC 8215
	sixToFour      = mustCIDR("2002::/16")       // RFC 3056
	ipv4Compatible = mustCIDR("::/96")           // RFC 4291, deprecated
	ipv4Translated = mustCIDR("::ffff:0:0:0/96") // RFC 2765, deprecated
)

// blockedNets are the CIDRs we refuse to dial from /test-upstream and
// /wsdl/fetch. Resolving a user-supplied host to any of these makes the
// endpoint a reachability oracle for the dashboard host's internal network
// (cloud metadata, etcd, the docker daemon, etc.).
//
// The list is the IANA special-purpose address registries, minus what
// net.IP's own predicates already cover (loopback, link-local, multicast, the
// unspecified and broadcast addresses, RFC 1918 and fc00::/7, all checked in
// isBlockedAddr). Taken from a published source rather than grown one report at
// a time: the first version of this list had been written from the ranges
// somebody had thought of (#304), and #308 found six more.
//
// What no list can cover is a network-specific NAT64 prefix inside otherwise
// global space, which RFC 6052 lets an operator choose freely. That is what
// reading the embedded address out is for, where the form allows it.
var blockedNets = []*net.IPNet{
	// IANA IPv4 Special-Purpose Address Registry.
	mustCIDR("0.0.0.0/8"),       // "this network"; on Linux it reaches this host
	mustCIDR("100.64.0.0/10"),   // CGNAT / shared address space
	mustCIDR("192.0.0.0/24"),    // IETF protocol assignments
	mustCIDR("192.0.2.0/24"),    // documentation, TEST-NET-1
	mustCIDR("192.31.196.0/24"), // AS112
	mustCIDR("192.52.193.0/24"), // AMT
	mustCIDR("192.88.99.0/24"),  // 6to4 relay anycast, deprecated
	mustCIDR("192.175.48.0/24"), // direct delegation AS112
	mustCIDR("198.18.0.0/15"),   // benchmarking, used as internal space
	mustCIDR("198.51.100.0/24"), // documentation, TEST-NET-2
	mustCIDR("203.0.113.0/24"),  // documentation, TEST-NET-3
	mustCIDR("240.0.0.0/4"),     // reserved

	// IANA IPv6 Special-Purpose Address Registry.
	mustCIDR("100::/64"),          // discard-only
	mustCIDR("2001::/32"),         // Teredo
	mustCIDR("2001:1::1/128"),     // Port Control Protocol anycast
	mustCIDR("2001:1::2/128"),     // DS-Lite AFTR anycast
	mustCIDR("2001:2::/48"),       // benchmarking
	mustCIDR("2001:3::/32"),       // AMT
	mustCIDR("2001:4:112::/48"),   // AS112
	mustCIDR("2001:10::/28"),      // ORCHID, deprecated
	mustCIDR("2001:20::/28"),      // ORCHIDv2
	mustCIDR("2001:30::/28"),      // drone remote ID
	mustCIDR("2001:db8::/32"),     // documentation
	mustCIDR("2620:4f:8000::/48"), // direct delegation AS112
	mustCIDR("5f00::/16"),         // SRv6 SIDs, inside a provider network

	// The v4-in-v6 forms whose prefix is fixed.
	nat64WellKnown,
	nat64LocalUse,
	sixToFour,
	ipv4Compatible,
	ipv4Translated,
}

// embeddedIPv4 returns the IPv4 address an IPv6 address carries, and nil for
// every other address - including an IPv4 one, which is what stops the check
// that calls this from recurring more than once.
func embeddedIPv4(ip net.IP) net.IP {
	if ip.To4() != nil {
		return nil // already IPv4, including the IPv4-mapped form
	}
	v6 := ip.To16()
	if v6 == nil {
		return nil
	}
	switch {
	// RFC 4291 excludes the unspecified and loopback addresses from the
	// IPv4-compatible format: they carry no address, and answering 0.0.0.1 for
	// ::1 would be an answer somebody could believe.
	case ipv4Compatible.Contains(v6):
		if ip.IsUnspecified() || ip.IsLoopback() {
			return nil
		}
		return net.IPv4(v6[12], v6[13], v6[14], v6[15])
	// RFC 6052 puts the address in the last four bytes of a /96 prefix. The
	// local-use prefix is a /48, whose layout depends on the prefix length the
	// network chose, so it is refused as a range rather than read.
	case nat64WellKnown.Contains(v6), ipv4Translated.Contains(v6):
		return net.IPv4(v6[12], v6[13], v6[14], v6[15])
	// RFC 3056: 2002:V4ADDR::/48.
	case sixToFour.Contains(v6):
		return net.IPv4(v6[2], v6[3], v6[4], v6[5])
	// RFC 5214: an interface identifier of [0200|0000]:5efe:V4ADDR, under any
	// prefix at all - which is why this one has to be read rather than listed.
	case v6[10] == 0x5e && v6[11] == 0xfe && v6[9] == 0x00 &&
		(v6[8] == 0x00 || v6[8] == 0x02):
		return net.IPv4(v6[12], v6[13], v6[14], v6[15])
	}
	return nil
}

func isBlockedAddr(ip net.IP) bool {
	if ip == nil {
		return true
	}
	// The stdlib's own conjunction: the unspecified address, loopback,
	// multicast in either scope, link-local, the IPv4 broadcast address - and
	// false for a slice that is not 4 or 16 bytes long, which the predicates
	// this replaces each answered false to, letting it through.
	if !ip.IsGlobalUnicast() {
		return true
	}
	// RFC 1918 and fc00::/7, kept by the standard library rather than here.
	if ip.IsPrivate() {
		return true
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return true
		}
	}
	// An IPv4 address inside an IPv6 one is checked as the address it is. It is
	// IPv4 by then, so this recurs exactly once.
	if v4 := embeddedIPv4(ip); v4 != nil {
		return isBlockedAddr(v4)
	}
	return false
}

// errAddrNotAllowed is returned for an internal address, and for a name that
// does not resolve: an answer that told the two apart would say which internal
// names exist on the dashboard's network.
var errAddrNotAllowed = errors.New("address not allowed")

// lookupIP resolves a name and dialContext opens a connection, each within
// 5 s. Tests replace them, so that they depend on neither the machine's
// resolver nor its network.
var (
	lookupIP = func(ctx context.Context, host string) ([]net.IP, error) {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return net.DefaultResolver.LookupIP(ctx, "ip", host)
	}
	dialContext = (&net.Dialer{Timeout: 5 * time.Second}).DialContext
)

const (
	// maxTestNodes bounds one /test-upstream request, which dials every node.
	maxTestNodes = 100
	// maxTestBodyBytes is far more than maxTestNodes nodes take. It keeps a
	// body of any size from being decoded before the nodes are counted.
	maxTestBodyBytes = 64 << 10
	// probeWorkers bounds one request's own fan-out. A hundred nodes used to
	// mean a hundred goroutines, each with a lookup and a dial of up to five
	// seconds; with middleware.MaxConcurrentProbes requests in flight, the
	// connections the dashboard holds open have a ceiling of their own rather
	// than one per request (#310).
	probeWorkers = 8
)

func resolveAllowedIP(ctx context.Context, host string) (net.IP, error) {
	// APISIX takes an IPv6 node in brackets, which ParseIP does not.
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = host[1 : len(host)-1]
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedAddr(ip) {
			return nil, errAddrNotAllowed
		}
		return ip, nil
	}
	ips, err := lookupIP(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, errAddrNotAllowed
	}
	for _, ip := range ips {
		if isBlockedAddr(ip) {
			return nil, errAddrNotAllowed
		}
	}
	return ips[0], nil
}

type UpstreamHandler struct{}

func NewUpstreamHandler() *UpstreamHandler {
	return &UpstreamHandler{}
}

type TestUpstreamNode struct {
	Host string `json:"host" binding:"required"`
	Port int    `json:"port" binding:"required"`
}

type TestUpstreamRequest struct {
	Nodes  []TestUpstreamNode `json:"nodes" binding:"required,min=1"`
	Scheme string             `json:"scheme"`
}

type NodeTestResult struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Status  string `json:"status"`
	Message string `json:"message"`
	RTTMs   int64  `json:"rtt_ms,omitempty"`
}

type TestUpstreamResponse struct {
	Status  string           `json:"status"`
	Results []NodeTestResult `json:"results"`
}

func (h *UpstreamHandler) TestConnection(c *gin.Context) {
	// Who may ask this is middleware.RequireResourcePermission's answer, on
	// the route itself, with the route test and the WSDL fetch (#307).
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTestBodyBytes)
	var req TestUpstreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Request body too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Nodes) > maxTestNodes {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("At most %d nodes per request", maxTestNodes)})
		return
	}

	// Lookups and dials stop when the caller goes away.
	ctx := c.Request.Context()
	results := make([]NodeTestResult, len(req.Nodes))
	var wg sync.WaitGroup

	// Acquired before the goroutine starts, so the ceiling bounds the
	// goroutines as well as the connections.
	slots := make(chan struct{}, probeWorkers)

	for i, node := range req.Nodes {
		wg.Add(1)
		slots <- struct{}{}
		go func(idx int, n TestUpstreamNode) {
			defer wg.Done()
			defer func() { <-slots }()

			if n.Port < 1 || n.Port > 65535 {
				results[idx] = NodeTestResult{Host: n.Host, Port: n.Port, Status: NodeFailed, Message: "Connection failed"}
				return
			}

			ip, err := resolveAllowedIP(ctx, n.Host)
			// Not tried, so not reported as down (#304): an internal address,
			// which in a Docker or Kubernetes deployment nearly every upstream
			// has, or a name that does not resolve, which must read the same.
			if err != nil {
				results[idx] = NodeTestResult{Host: n.Host, Port: n.Port, Status: NodeNotAllowed, Message: "Not tested: not a public address the dashboard can resolve"}
				return
			}

			addr := net.JoinHostPort(ip.String(), fmt.Sprintf("%d", n.Port))
			start := time.Now()
			conn, err := dialContext(ctx, "tcp", addr)
			rtt := time.Since(start).Milliseconds()
			if err != nil {
				results[idx] = NodeTestResult{Host: n.Host, Port: n.Port, Status: NodeFailed, Message: "Connection failed"}
				return
			}
			conn.Close()

			results[idx] = NodeTestResult{
				Host:    n.Host,
				Port:    n.Port,
				Status:  NodeConnected,
				Message: "Connection successful",
				RTTMs:   rtt,
			}
		}(i, node)
	}

	wg.Wait()

	c.JSON(http.StatusOK, TestUpstreamResponse{
		Status:  overallStatus(results),
		Results: results,
	})
}

// The status of one node's test. The overall status of a request is one of
// these too, or StatusPartial.
const (
	NodeConnected = "connected"
	NodeFailed    = "failed"
	// NodeNotAllowed: not tried. The address is internal, or the name does
	// not resolve.
	NodeNotAllowed = "not_allowed"
)

// StatusPartial: some nodes connected, and some did not.
const StatusPartial = "partial"

// overallStatus sums up the nodes. It is not_allowed when no node was tried
// at all: none is known to be down, and "failed" would say they were.
func overallStatus(results []NodeTestResult) string {
	var connected, notAllowed int
	for _, r := range results {
		switch r.Status {
		case NodeConnected:
			connected++
		case NodeNotAllowed:
			notAllowed++
		}
	}
	switch {
	case len(results) == 0:
		return NodeFailed
	case connected == len(results):
		return NodeConnected
	case connected > 0:
		return StatusPartial
	case notAllowed == len(results):
		return NodeNotAllowed
	default:
		return NodeFailed
	}
}
