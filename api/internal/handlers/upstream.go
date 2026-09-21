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
	"errors"
	"fmt"
	"net"
	"net/http"
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

var (
	errAddrNotAllowed = errors.New("address not allowed")
	errHostNotFound   = errors.New("host not found")
)

func resolveAllowedIP(host string) (net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedAddr(ip) {
			return nil, errAddrNotAllowed
		}
		return ip, nil
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return nil, errHostNotFound
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
	var req TestUpstreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

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

			ip, err := resolveAllowedIP(n.Host)
			// A refused address was never tried, so it is not reported as
			// down: in a Docker or Kubernetes deployment nearly every
			// upstream has one (#304). For a name, this does say that it
			// resolves to an internal address. Anyone who can create a route
			// can reach such a host through the gateway anyway.
			if errors.Is(err, errAddrNotAllowed) {
				results[idx] = NodeTestResult{Host: n.Host, Port: n.Port, Status: NodeNotAllowed, Message: "Not tested: internal address"}
				return
			}
			if err != nil {
				results[idx] = NodeTestResult{Host: n.Host, Port: n.Port, Status: NodeFailed, Message: "Connection failed"}
				return
			}

			addr := net.JoinHostPort(ip.String(), fmt.Sprintf("%d", n.Port))
			start := time.Now()
			conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
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

// The status of one node's test.
const (
	NodeConnected = "connected"
	NodeFailed    = "failed"
	// NodeNotAllowed: the address is internal, and was not tried.
	NodeNotAllowed = "not_allowed"
)

// overallStatus is "partial" only when some node did connect. With none
// connected it is "failed", even when none was tried: nothing was confirmed.
func overallStatus(results []NodeTestResult) string {
	connected := 0
	for _, r := range results {
		if r.Status == NodeConnected {
			connected++
		}
	}
	switch connected {
	case len(results):
		return NodeConnected
	case 0:
		return NodeFailed
	default:
		return "partial"
	}
}
