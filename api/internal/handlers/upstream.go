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

// blockedNets are the CIDRs we refuse to dial from /test-upstream. Resolving a
// user-supplied host to any of these makes the endpoint a reachability oracle
// for the dashboard host's internal network (cloud metadata, etcd, the docker
// daemon, etc.). The IP-property helpers already cover loopback/link-local/
// multicast/unspecified; this list adds the private RFC1918 ranges and IPv6
// unique-local that those helpers do not flag.
var blockedNets = func() []*net.IPNet {
	cidrs := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"100.64.0.0/10", // CGNAT
		"fc00::/7",      // IPv6 unique-local
	}
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		if _, n, err := net.ParseCIDR(c); err == nil {
			out = append(out, n)
		}
	}
	return out
}()

func isBlockedAddr(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return true
		}
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

	for i, node := range req.Nodes {
		wg.Add(1)
		go func(idx int, n TestUpstreamNode) {
			defer wg.Done()

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
