package handlers

import (
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

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
			addr := fmt.Sprintf("%s:%d", n.Host, n.Port)
			start := time.Now()

			conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
			rtt := time.Since(start).Milliseconds()

			if err != nil {
				results[idx] = NodeTestResult{
					Host:    n.Host,
					Port:    n.Port,
					Status:  "failed",
					Message: fmt.Sprintf("Connection failed: %v", err),
				}
				return
			}
			conn.Close()

			results[idx] = NodeTestResult{
				Host:    n.Host,
				Port:    n.Port,
				Status:  "connected",
				Message: "Connection successful",
				RTTMs:   rtt,
			}
		}(i, node)
	}

	wg.Wait()

	allConnected := true
	for _, r := range results {
		if r.Status != "connected" {
			allConnected = false
			break
		}
	}

	status := "connected"
	if !allConnected {
		status = "partial"
	}

	c.JSON(http.StatusOK, TestUpstreamResponse{
		Status:  status,
		Results: results,
	})
}
