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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// dashboardHealthField carries what the gateway's health checkers have seen
// for an upstream (#281).
//
// Three answers, and the page must be able to tell them apart, because they
// call for opposite actions:
//
//   - the field absent: the gateway could not be asked - it exposes no Control
//     API, or the address it gave did not answer. Nothing is known.
//   - `{"checked": false}`: it was asked, this upstream declares no health
//     check, and the report did not mention it. Nothing is watching it, which
//     is not the same as nothing being wrong.
//   - `{"checked": true, "nodes": [...]}`: it is watched, and these are the
//     states its nodes are in. The list can be empty - APISIX creates a
//     checker when the upstream is first used, so one never used has nothing
//     measured yet, and so does one whose reading was taken a moment before it
//     was written.
const dashboardHealthField = dashboardFieldPrefix + "health"

// upstreamHealthWarning names the caveat for a list whose health could not be
// read although an address was given for it. A gateway with no control address
// raises no warning: there is nothing wrong with not exposing that port.
const upstreamHealthWarning = "upstream_health_unresolved"

// upstreamHealthTimeout bounds the control API read. Short: the upstream list
// is readable without health and says so, and this address is one more thing
// that can hang.
const upstreamHealthTimeout = 3 * time.Second

// upstreamHealthCacheTTL is how long a reading is reused. Shorter than the
// counts beside it: health is the one thing on this page that changes by
// itself, and an operator watching a node come back wants the page to follow
// rather than to hold a stale green for ten seconds.
const upstreamHealthCacheTTL = 3 * time.Second

// maxControlResponseBytes caps what is read from the control API. It is a
// different service from the Admin API, on a port this dashboard was merely
// told about, and a body without an end would otherwise be read without one.
const maxControlResponseBytes = 4 << 20 // 4 MiB

// errNoControlAPI marks an instance that exposes no Control API. Not a
// failure: most gateways do not expose one, and the page says "not known"
// rather than warning about it.
var errNoControlAPI = errors.New("instance has no control API address")

// healthNode is one target of an upstream, and the state its checker holds for
// it: healthy, unhealthy, mostly_healthy or mostly_unhealthy, as
// resty.healthcheck names them.
type healthNode struct {
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Status string `json:"status"`
}

// upstreamHealthEntry is what is known about one upstream's health.
type upstreamHealthEntry struct {
	Nodes []healthNode
}

// upstreamHealth maps an upstream id to what its checker reported. An upstream
// with no entry was not reported on, which annotateUpstreamHealth reads
// together with the row's own `checks`.
type upstreamHealth map[string]upstreamHealthEntry

// upstreamHealthReading is one attempt at reading a gateway's health: what
// came back, or the fact that nothing did.
//
// A failure is cached like a success, which the caches beside this one do not
// do. They read the Admin API, whose reachability the request in hand has just
// proved; this address is one more thing that can hang, given to the dashboard
// rather than tested by it. Uncached, a wrong address made every upstream page
// wait the whole timeout - something any reader could ask for repeatedly.
type upstreamHealthReading struct {
	Health upstreamHealth
	Failed bool
}

// upstreamHealthCache holds one reading per instance, briefly.
type upstreamHealthCache = instanceCache[upstreamHealthReading]

func newUpstreamHealthCache(now func() time.Time) *upstreamHealthCache {
	return newInstanceCache[upstreamHealthReading](now, upstreamHealthCacheTTL)
}

// annotateUpstreamHealth writes onto an upstream row what its checker reports,
// or that it has none. Called only when the gateway answered: an upstream the
// dashboard could not ask about is left without the field entirely.
//
// The report says what is running, not what is configured, so the row's own
// `checks` has the last word on whether anything watches it. An upstream that
// declares one and is missing from the report has a checker that has not been
// built yet - APISIX builds one the first time the upstream is used - and
// saying "nothing is watching this" about it would be a firm claim in the
// dangerous direction.
func annotateUpstreamHealth(value map[string]any, health upstreamHealth) {
	entry, reported := health[idField(value, "id")]
	if !reported {
		if _, configured := value["checks"]; configured {
			value[dashboardHealthField] = map[string]any{
				"checked": true,
				"nodes":   []map[string]any{},
			}
			return
		}
		value[dashboardHealthField] = map[string]any{"checked": false}
		return
	}

	nodes := make([]map[string]any, 0, len(entry.Nodes))
	for _, node := range entry.Nodes {
		nodes = append(nodes, map[string]any{
			"host":   node.Host,
			"port":   node.Port,
			"status": node.Status,
		})
	}
	value[dashboardHealthField] = map[string]any{"checked": true, "nodes": nodes}
}

// fetchUpstreamHealth asks a gateway what its health checkers have seen.
//
// The address is the one stored on the instance and nothing else - never a
// parameter, a header or anything else a caller could choose - and the path is
// fixed. The Control API is unauthenticated and not read-only: it reloads
// plugins and triggers dumps, so a request built from anything the caller says
// would make this backend a way to reach it.
func fetchUpstreamHealth(ctx context.Context, instance *models.Instance) (upstreamHealth, error) {
	base := strings.TrimSpace(instance.ControlAPIURL)
	if base == "" {
		return nil, errNoControlAPI
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("control API address: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("control API address is not http: %q", parsed.Scheme)
	}

	ctx, cancel := context.WithTimeout(ctx, upstreamHealthTimeout)
	defer cancel()

	// Built from the parsed address rather than the stored string, with
	// anything after the host dropped: a query or a fragment kept on it would
	// make the "fixed path" not one.
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/v1/healthcheck"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	// Without it the answer is HTML, which is what that endpoint renders for a
	// browser.
	req.Header.Set("Accept", "application/json")

	resp, err := controlClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("control API returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxControlResponseBytes))
	if err != nil {
		return nil, err
	}
	return parseUpstreamHealth(body)
}

// controlClient talks to the Control API, and follows nothing.
//
// A redirect would be followed from where this backend sits, which is a
// position on the network the caller does not have - the reason to refuse one
// rather than trust the address it names.
var controlClient = &http.Client{
	Timeout: upstreamHealthTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// upstreamKeySegment is how the control API names an upstream: by its etcd
// key, whose prefix is a deployment setting rather than a constant - this
// repo's own second gateway runs on `/apisix2`. Matching the segment rather
// than the whole prefix means an id is found on either (#281).
const upstreamKeySegment = "/upstreams/"

// parseUpstreamHealth reads the control API's report, keeping the upstreams.
//
// Routes, services and stream routes can carry their own upstream and their
// own checks, and appear in the same answer. Their health is not an upstream
// record's health, and filing it under one would name the state of something
// else.
func parseUpstreamHealth(body []byte) (upstreamHealth, error) {
	// A gateway with no health checker running answers `{}`: the report is
	// built as a Lua table, and an empty one serialises as an object rather
	// than as an array - the quirk this repo already works around for `list`
	// on the Admin API. It means "none", not "unreadable", and reading it as a
	// failure made every row say health could not be known (#281).
	//
	// An object with something in it is another matter: the control API says
	// `{"error_msg": ...}` when it refuses, and that is not a report.
	if bytes.Equal(bytes.TrimSpace(body), []byte("{}")) {
		return upstreamHealth{}, nil
	}

	// `nodes` is decoded loosely for the reason the whole body is: it is a Lua
	// table too, and a checker with no target yet sends `{}` rather than `[]`.
	// The same quirk, one level down - and the one CI found after the first.
	var reported []struct {
		Name  string          `json:"name"`
		Nodes json.RawMessage `json:"nodes"`
	}
	if err := json.Unmarshal(body, &reported); err != nil {
		return nil, err
	}

	health := upstreamHealth{}
	for _, item := range reported {
		cut := strings.LastIndex(item.Name, upstreamKeySegment)
		if cut < 0 {
			continue
		}
		id := item.Name[cut+len(upstreamKeySegment):]
		if id == "" || strings.Contains(id, "/") {
			continue
		}

		var targets []struct {
			IP       string `json:"ip"`
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Hostname string `json:"hostname"`
			Status   string `json:"status"`
		}
		// Anything that is not a list of targets is no targets: an empty Lua
		// table, a null, a shape a later APISIX invents. The upstream is still
		// reported as watched, which is the part that matters.
		if err := json.Unmarshal(item.Nodes, &targets); err != nil {
			targets = nil
		}

		nodes := make([]healthNode, 0, len(targets))
		for _, node := range targets {
			// resty.healthcheck names the address `ip`, whatever it holds -
			// a hostname included. `host` is read too in case a later APISIX
			// renames it, and the hostname is the fallback for a target given
			// by name.
			host := node.IP
			if host == "" {
				host = node.Host
			}
			if host == "" {
				host = node.Hostname
			}
			nodes = append(nodes, healthNode{Host: host, Port: node.Port, Status: node.Status})
		}
		health[id] = upstreamHealthEntry{Nodes: nodes}
	}
	return health, nil
}
