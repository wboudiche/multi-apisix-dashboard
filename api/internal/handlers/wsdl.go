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
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	wsdlMaxDocs      = 20
	wsdlMaxDepth     = 5
	wsdlMaxDocBytes  = 5 << 20
	wsdlMaxTotalByte = 20 << 20
	wsdlHTTPTimeout  = 10 * time.Second
)

// WsdlHandler serves GET /api/v1/wsdl/fetch, recursively fetching WSDL
// documents server-side (bypassing browser CORS) while guarding against SSRF
// via a custom DialContext that re-validates the resolved IP on every
// connection, including through redirects.
type WsdlHandler struct {
	client *http.Client
}

// guardedClient dials only IPs that pass resolveAllowedIP, re-checking on every
// connection (including redirects), which also defeats DNS rebinding.
func guardedClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	return &http.Client{
		Timeout: wsdlHTTPTimeout,
		Transport: &http.Transport{
			TLSHandshakeTimeout: 5 * time.Second,
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				ip, err := resolveAllowedIP(host)
				if err != nil {
					return nil, err
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			},
		},
	}
}

// NewWsdlHandler returns a WsdlHandler backed by the SSRF-guarded HTTP client.
func NewWsdlHandler() *WsdlHandler {
	return &WsdlHandler{client: guardedClient()}
}

// newWsdlHandlerWithClient is for tests that target a loopback httptest server.
func newWsdlHandlerWithClient(client *http.Client) *WsdlHandler {
	return &WsdlHandler{client: client}
}

// parseWsdlImportLocations returns the location attributes of every <*:import>
// element found in the given XML document. It intentionally ignores
// schemaLocation (XSD imports) — only WSDL-level imports are followed.
func parseWsdlImportLocations(body []byte) []string {
	var out []string
	dec := xml.NewDecoder(strings.NewReader(string(body)))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "import" {
			continue
		}
		for _, a := range se.Attr {
			if a.Name.Local == "location" && a.Value != "" {
				out = append(out, a.Value)
			}
		}
	}
	return out
}

func validateWsdlURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("only http and https urls are allowed")
	}
	if u.User != nil {
		return nil, fmt.Errorf("credentials in url are not allowed")
	}
	if u.Host == "" {
		return nil, fmt.Errorf("url has no host")
	}
	return u, nil
}

func (h *WsdlHandler) fetchOne(ctx context.Context, raw string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, wsdlMaxDocBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > wsdlMaxDocBytes {
		return nil, fmt.Errorf("document exceeds %d bytes", wsdlMaxDocBytes)
	}
	return body, nil
}

// Fetch handles GET /api/v1/wsdl/fetch?url=<url>.
// It recursively resolves wsdl:import locations and returns JSON:
//
//	{ "entry": <url>, "docs": { <absURL>: <content> }, "warnings": [...] }
func (h *WsdlHandler) Fetch(c *gin.Context) {
	raw := c.Query("url")
	entry, err := validateWsdlURL(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	docs := map[string]string{}
	warnings := []string{}
	total := 0

	type item struct {
		u     *url.URL
		depth int
	}
	queue := []item{{u: entry, depth: 0}}
	seen := map[string]bool{}

	for len(queue) > 0 {
		if len(docs) >= wsdlMaxDocs {
			warnings = append(warnings, "import graph truncated: too many documents")
			break
		}
		cur := queue[0]
		queue = queue[1:]
		key := cur.u.String()
		if seen[key] {
			continue
		}
		seen[key] = true

		if _, blockErr := validateWsdlURL(key); blockErr != nil {
			warnings = append(warnings, fmt.Sprintf("skipped %s: %v", key, blockErr))
			continue
		}

		body, fErr := h.fetchOne(ctx, key)
		if fErr != nil {
			if len(docs) == 0 {
				c.JSON(http.StatusBadGateway, gin.H{"error": fErr.Error()})
				return
			}
			warnings = append(warnings, fmt.Sprintf("failed to fetch %s: %v", key, fErr))
			continue
		}

		total += len(body)
		if total > wsdlMaxTotalByte {
			warnings = append(warnings, "import graph truncated: total size limit reached")
			break
		}
		docs[key] = string(body)

		if cur.depth >= wsdlMaxDepth {
			continue
		}
		for _, loc := range parseWsdlImportLocations(body) {
			ref, pErr := url.Parse(loc)
			if pErr != nil {
				continue
			}
			abs := cur.u.ResolveReference(ref)
			if !seen[abs.String()] {
				queue = append(queue, item{u: abs, depth: cur.depth + 1})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"entry":    entry.String(),
		"docs":     docs,
		"warnings": warnings,
	})
}
