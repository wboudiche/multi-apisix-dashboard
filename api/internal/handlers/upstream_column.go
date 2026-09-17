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

// The fields the proxy writes onto each route row, beside __team_id, so that
// the Upstream column reads the answer rather than working it out in the
// browser. There, a non-admin's service list is narrowed to their team and cut
// at 500 rows: the column said "no upstream" for any route bound to a service
// outside it, while the upstream filter, resolving here, matched the same
// route (#161). Like every "__" field, they are stripped on write.
const (
	dashboardUpstreamIDField     = dashboardFieldPrefix + "upstream_id"
	dashboardUpstreamInlineField = dashboardFieldPrefix + "upstream_inline"
)

// serviceUpstream is what a service points its routes at: an upstream by id,
// or one carried inline, which has no id.
type serviceUpstream struct {
	ID     string
	Inline bool
}

// serviceUpstreams maps a service id to the upstream it points at. A service
// that reaches no upstream at all has no entry.
type serviceUpstreams map[string]serviceUpstream

// effectiveUpstream reports the upstream a route reaches, in the order APISIX
// applies them: an upstream_id of its own, else an upstream carried inline,
// else whatever its service points at.
//
// An upstream of its own wins even alongside a service_id. Resolving through
// the service would name a backend the route never reaches, and during an
// incident that is a route reported as depending on the gateway being drained.
// The upstream filter and the Upstream column both read this, so they cannot
// answer the same question two ways.
func effectiveUpstream(value map[string]any, services serviceUpstreams) (id string, inline bool) {
	if own := idField(value, "upstream_id"); own != "" {
		return own, false
	}
	if _, carried := value["upstream"]; carried {
		return "", true
	}
	if serviceID := idField(value, "service_id"); serviceID != "" {
		service := services[serviceID]
		return service.ID, service.Inline
	}
	return "", false
}

// annotateUpstream writes onto a route row the upstream it reaches: its id, or
// a flag for one carried inline. A row reaching none gets neither, which is
// what the column reads as "no upstream".
func annotateUpstream(value map[string]any, services serviceUpstreams) {
	id, inline := effectiveUpstream(value, services)
	if id != "" {
		value[dashboardUpstreamIDField] = id
	}
	if inline {
		value[dashboardUpstreamInlineField] = true
	}
}
