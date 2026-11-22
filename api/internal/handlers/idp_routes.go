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

// readAdminObject reads one object of the Admin API, reporting whether it
// exists. It accepts the value-wrapped body and the flat one.
func readAdminObject(ctx context.Context, inst *models.Instance, path string, dest any) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, routeLookupTimeout)
	defer cancel()

	req, err := newAdminRequest(ctx, inst, path)
	if err != nil {
		return false, err
	}
	resp, err := proxyClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		return false, fmt.Errorf("admin API returned status %d", resp.StatusCode)
	}
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return false, err
	}
	var wrapped struct {
		Value json.RawMessage `json:"value"`
	}
	if json.Unmarshal(raw, &wrapped) == nil && len(wrapped.Value) > 0 {
		raw = wrapped.Value
	}
	return true, json.Unmarshal(raw, dest)
}

// hostFields are the fields of a route or service that say which hosts it
// answers to.
type hostFields struct {
	Host       string   `json:"host"`
	CreateTime float64  `json:"create_time"`
	Hosts      []string `json:"hosts"`
	ServiceID  any      `json:"service_id"`
}

func (f hostFields) all() []string {
	out := append([]string{}, f.Hosts...)
	if f.Host != "" {
		out = append(out, f.Host)
	}
	return out
}

// routeFacts is what the client provisioning needs of a route: the hosts it
// matches (its "host" and "hosts", else those of its service), the APISIX
// create_time (seconds; 0 when the gateway gives none) and whether it exists.
type routeFacts struct {
	Hosts      []string
	CreateTime int64
	Found      bool
}

// readRoute asks the instance's Admin API for a route.
func readRoute(ctx context.Context, inst *models.Instance, routeID string) (routeFacts, error) {
	var route hostFields
	found, err := readAdminObject(ctx, inst, "/routes/"+url.PathEscape(routeID), &route)
	if err != nil || !found {
		return routeFacts{}, err
	}
	facts := routeFacts{Hosts: route.all(), CreateTime: int64(route.CreateTime), Found: true}
	if len(facts.Hosts) > 0 || route.ServiceID == nil {
		return facts, nil
	}
	serviceID := fmt.Sprint(route.ServiceID)
	if serviceID == "" {
		return facts, nil
	}
	var service hostFields
	sfound, err := readAdminObject(ctx, inst, "/services/"+url.PathEscape(serviceID), &service)
	if err != nil {
		return routeFacts{}, err
	}
	if sfound {
		facts.Hosts = service.all()
	}
	return facts, nil
}

// routeCreateTimes maps the id of each listed route to its create_time.
func routeCreateTimes(routes []map[string]any) map[string]int64 {
	out := make(map[string]int64, len(routes))
	for _, r := range routes {
		id, ok := r["id"]
		if !ok || id == nil {
			continue
		}
		ct, _ := r["create_time"].(float64)
		out[fmt.Sprint(id)] = int64(ct)
	}
	return out
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
	func(context.Context, *models.Instance, string) (routeFacts, error),
	func(context.Context, *models.Instance) ([]map[string]any, error),
) {
	return readRoute, listInstanceRoutes
}
