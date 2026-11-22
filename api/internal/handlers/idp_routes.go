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
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// idpRouteListTimeout bounds the read of every route of an instance.
const idpRouteListTimeout = 30 * time.Second

// readRouteHosts asks the instance's Admin API for a route and returns the
// hosts it matches (its "host" and "hosts"), and whether it exists.
func readRouteHosts(ctx context.Context, inst *models.Instance, routeID string) ([]string, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, routeLookupTimeout)
	defer cancel()

	req, err := newAdminRequest(ctx, inst, "/routes/"+url.PathEscape(routeID))
	if err != nil {
		return nil, false, err
	}
	resp, err := proxyClient.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, false, nil
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		return nil, false, fmt.Errorf("admin API returned status %d", resp.StatusCode)
	}

	type hostFields struct {
		Host  string   `json:"host"`
		Hosts []string `json:"hosts"`
	}
	var body struct {
		Value *hostFields `json:"value"`
		hostFields
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, false, err
	}
	f := body.hostFields
	if body.Value != nil {
		f = *body.Value
	}
	hosts := append([]string{}, f.Hosts...)
	if f.Host != "" {
		hosts = append(hosts, f.Host)
	}
	return hosts, true, nil
}

// listInstanceRoutes returns the configuration of every route of the instance,
// each as the object APISIX holds (the "value" of its list entry).
func listInstanceRoutes(ctx context.Context, inst *models.Instance) ([]map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, idpRouteListTimeout)
	defer cancel()

	req, err := newAdminRequest(ctx, inst, "/routes")
	if err != nil {
		return nil, err
	}
	resp, err := proxyClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("admin API returned status %d", resp.StatusCode)
	}

	var body struct {
		List []struct {
			Value map[string]any `json:"value"`
		} `json:"list"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(body.List))
	for _, e := range body.List {
		if e.Value != nil {
			out = append(out, e.Value)
		}
	}
	return out, nil
}

// NewIdPRouteReaders are the readers main wires into the IdP handler.
func NewIdPRouteReaders() (
	func(context.Context, *models.Instance, string) ([]string, bool, error),
	func(context.Context, *models.Instance) ([]map[string]any, error),
) {
	return readRouteHosts, listInstanceRoutes
}
