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
	"log"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// dashboardServiceCountField joins the two count fields the service list
// already carries (see service_route_count.go). An upstream is depended on by
// all three kinds, and they stay apart because they are reached from three
// different pages.
const dashboardServiceCountField = dashboardFieldPrefix + "service_count"

// upstreamDependantsWarning names the caveat for an upstream list that could
// not say what depends on each row, resolved by the client through its own
// catalogue like every other warning code this proxy sends.
const upstreamDependantsWarning = "upstream_dependants_unresolved"

// upstreamDependantsCacheTTL is how long a reading is reused. Short for the
// reason the other two are: the question is what depends on this upstream right
// now, and a write to any of the three kinds drops it outright.
const upstreamDependantsCacheTTL = 10 * time.Second

// upstreamDependantCount is what leans on one upstream. Routes and stream
// routes name it directly; a service names it for all the routes bound to that
// service, which is why it is worth counting on its own rather than folding in.
type upstreamDependantCount struct {
	Routes       int
	StreamRoutes int
	Services     int
}

// upstreamDependants maps an upstream id to what depends on it. An upstream
// nothing names has no entry, which annotateUpstreamDependants writes as zeros.
type upstreamDependants map[string]upstreamDependantCount

// upstreamDependantsResult is one reading of a gateway: the counts, and which
// kinds were part of them. A kind that could not be read is not a kind with
// nothing in it, and the page has to be able to tell.
type upstreamDependantsResult struct {
	Counts          upstreamDependants
	StreamCounted   bool
	ServicesCounted bool
}

// upstreamDependantsCache holds one reading per instance, briefly.
type upstreamDependantsCache = instanceCache[upstreamDependantsResult]

func newUpstreamDependantsCache(now func() time.Time) *upstreamDependantsCache {
	return newInstanceCache[upstreamDependantsResult](now, upstreamDependantsCacheTTL)
}

// annotateUpstreamDependants writes onto an upstream row what depends on it.
//
// Zeros are explicit, for the reason the service list's counts are: "nothing
// depends on this" and "I could not count" have opposite consequences for
// deleting it, and the page tells them apart by the field being there at all.
func annotateUpstreamDependants(value map[string]any, reading upstreamDependantsResult) {
	count := reading.Counts[idField(value, "id")]
	value[dashboardRouteCountField] = count.Routes
	if reading.ServicesCounted {
		value[dashboardServiceCountField] = count.Services
	}
	if reading.StreamCounted {
		value[dashboardStreamRouteCountField] = count.StreamRoutes
	}
}

// fetchUpstreamDependants counts, over the whole gateway, what names each
// upstream.
//
// The service table is passed in rather than read again: the proxy already
// holds one for the upstream filter and the Upstream column, and it maps each
// service to the upstream it points at - which is exactly the count wanted
// here, from the other end. A nil table is one that could not be read, as
// opposed to a gateway with no services.
func fetchUpstreamDependants(
	ctx context.Context, instance *models.Instance, services serviceUpstreams,
) (upstreamDependantsResult, error) {
	routes, err := fetchAdminList(ctx, instance, "routes")
	if err != nil {
		return upstreamDependantsResult{}, err
	}

	stream, streamErr := fetchAdminList(ctx, instance, "stream_routes")
	if isNoSuchCollection(streamErr) {
		// A gateway with stream_proxy off has no stream routes to count, which
		// is an answer rather than a failure.
		stream, streamErr = emptyCollection, nil
	}
	if streamErr != nil {
		log.Printf("[instance %s] could not list stream routes, the upstream list will say so: %v",
			instance.ID, streamErr)
		stream = nil
	}

	return parseUpstreamDependants(routes, stream, services)
}

// parseUpstreamDependants counts the upstream ids named by two admin listings
// and by the service table.
//
// A nil stream listing, or a nil service table, means it was not read: the
// routes still count, but the reading says so rather than passing "none read"
// off as "none there".
func parseUpstreamDependants(
	routes, streamRoutes []byte, services serviceUpstreams,
) (upstreamDependantsResult, error) {
	counts := upstreamDependants{}
	add := func(id string, f func(*upstreamDependantCount)) {
		count := counts[id]
		f(&count)
		counts[id] = count
	}

	if err := countReferences(routes, "upstream_id", func(id string) {
		add(id, func(c *upstreamDependantCount) { c.Routes++ })
	}); err != nil {
		return upstreamDependantsResult{}, err
	}

	// A service with its upstream inline has no id to name, and nothing to be
	// counted against.
	for _, service := range services {
		if service.ID == "" {
			continue
		}
		add(service.ID, func(c *upstreamDependantCount) { c.Services++ })
	}

	reading := upstreamDependantsResult{Counts: counts, ServicesCounted: services != nil}

	if len(streamRoutes) == 0 {
		return reading, nil
	}
	if err := countReferences(streamRoutes, "upstream_id", func(id string) {
		add(id, func(c *upstreamDependantCount) { c.StreamRoutes++ })
	}); err != nil {
		log.Printf("could not read the stream route listing, it will not be counted: %v", err)
		return reading, nil
	}
	reading.StreamCounted = true
	return reading, nil
}
