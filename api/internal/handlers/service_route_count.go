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
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// The fields the proxy writes onto each service row so that the list can say
// what depends on it. Counted here rather than in the browser because the
// browser only ever sees a narrowed list: rows the team filter dropped, and
// nothing past the 500 it asks for. A count built from that reads "nothing
// depends on this service" for one five of another team's routes rely on, and
// a developer may delete services (#277, same mistake as #161).
//
// Absent means "could not be read", which is why a service nothing depends on
// still carries a zero. Like every "__" field, they are stripped on write.
const (
	dashboardRouteCountField       = dashboardFieldPrefix + "route_count"
	dashboardStreamRouteCountField = dashboardFieldPrefix + "stream_route_count"
)

// routeCountWarning names the caveat for a service list whose routes could not
// be counted, resolved by the client through its own catalogue like every other
// warning code this proxy sends.
const routeCountWarning = "route_count_unresolved"

// serviceRouteCountLookupTimeout bounds the two listings a service page counts
// over. The page is readable without the counts and says so, so a gateway slow
// to list its routes should not hold the services behind it.
const serviceRouteCountLookupTimeout = 5 * time.Second

// serviceRouteCountCacheTTL is how long counts are reused. Short for the same
// reason the service table's window is: the question is "what depends on this
// service right now", so the answer should not outlive the asking. A write to
// routes, stream routes or services drops it outright.
const serviceRouteCountCacheTTL = 10 * time.Second

// serviceRouteCountCache holds one reading per instance, briefly. The reading
// rather than the counts: whether the stream routes were among them has to
// survive the cache, or the second page of a list would claim a count the
// first one refused to make.
type serviceRouteCountCache = instanceCache[serviceRouteCountResult]

func newServiceRouteCountCache(now func() time.Time) *serviceRouteCountCache {
	return newInstanceCache[serviceRouteCountResult](now, serviceRouteCountCacheTTL)
}

// routeCount is how many routes of each kind name one service. They are kept
// apart because the service detail page lists them under separate tabs, so a
// single total would match neither.
type routeCount struct {
	Routes       int
	StreamRoutes int
}

// serviceRouteCounts maps a service id to what depends on it. A service
// nothing names has no entry, which annotateRouteCount writes out as zero.
type serviceRouteCounts map[string]routeCount

// serviceRouteCountResult is one reading of a gateway: the counts, and whether
// the stream routes were part of them.
type serviceRouteCountResult struct {
	Counts        serviceRouteCounts
	StreamCounted bool
}

// annotateRouteCount writes onto a service row how many routes depend on it.
//
// A service nothing depends on is annotated with an explicit zero: the page
// tells "nothing depends on this" from "I could not count" by the field being
// there at all, and the two have opposite consequences for deleting it. The
// stream count follows the same rule, which is what streamCounted is for - a
// gateway whose stream routes could not be read must not answer "none".
func annotateRouteCount(value map[string]any, reading serviceRouteCountResult) {
	count := reading.Counts[idField(value, "id")]
	value[dashboardRouteCountField] = count.Routes
	if reading.StreamCounted {
		value[dashboardStreamRouteCountField] = count.StreamRoutes
	}
}

// fetchServiceRouteCounts counts, over the whole gateway, the routes and stream
// routes that name each service.
//
// Both kinds carry service_id and both keep a service alive, so a count of one
// kind would be a licence to delete a service the other kind still reaches.
// The reading says whether the stream routes were among them: a gateway that
// could not be asked must not have its silence read as "none", which is the
// answer that gets a service deleted.
//
// Each listing is given the deadline in full rather than sharing one. Sharing
// it meant a gateway slow on the first read failed the second on time and
// called that "no stream routes" - degrading into a wrong answer rather than
// into no answer.
func fetchServiceRouteCounts(ctx context.Context, instance *models.Instance) (serviceRouteCountResult, error) {
	routes, err := fetchAdminList(ctx, instance, "routes")
	if err != nil {
		return serviceRouteCountResult{}, err
	}

	stream, streamErr := fetchAdminList(ctx, instance, "stream_routes")
	if isNoSuchCollection(streamErr) {
		// A gateway with stream_proxy off refuses the collection outright.
		// There are no stream routes on it, which is a count, not a failure -
		// and the alternative was a warning on every service page, forever.
		stream, streamErr = emptyCollection, nil
	}
	streamCounted := streamErr == nil
	if streamErr != nil {
		log.Printf("[instance %s] could not list stream routes, the service list will say so: %v",
			instance.ID, streamErr)
	}

	counts, streamParsed, err := parseServiceRouteCounts(routes, stream)
	if err != nil {
		return serviceRouteCountResult{}, err
	}
	// Read and unreadable is the same as not read: either way nothing here
	// knows how many stream routes there are.
	return serviceRouteCountResult{Counts: counts, StreamCounted: streamCounted && streamParsed}, nil
}

// errNoSuchCollection marks a gateway that does not serve a collection at all,
// as opposed to one that failed to answer for it.
var errNoSuchCollection = errors.New("collection not served")

// isNoSuchCollection reports the refusal a gateway gives for a collection it
// does not serve - stream routes on one without stream_proxy, say.
func isNoSuchCollection(err error) bool {
	return errors.Is(err, errNoSuchCollection)
}

// emptyCollection stands in for a collection the gateway does not serve. It is
// the shape APISIX answers an empty one with, so it counts as none rather than
// reading as a listing that could not be had.
var emptyCollection = []byte(`{"list":[]}`)

// fetchAdminList reads one admin collection whole, within its own deadline.
func fetchAdminList(ctx context.Context, instance *models.Instance, resource string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, serviceRouteCountLookupTimeout)
	defer cancel()

	url := strings.TrimRight(instance.AdminAPIURL, "/") + "/apisix/admin/" + resource
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if instance.AdminKey != "" {
		req.Header.Set("X-API-Key", instance.AdminKey)
	}

	resp, err := proxyClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// 400 is how APISIX refuses stream_routes when stream_proxy is off, and 404
	// how an older gateway answers a collection it does not have. Neither is a
	// gateway failing to answer.
	if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("%s: %w (%d)", resource, errNoSuchCollection, resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s returned %d", resource, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// parseServiceRouteCounts counts the service ids named by two admin listings.
//
// The middle return says whether the stream listing was among them. An
// unreadable one does not take the route count down with it - that count is
// true and is the one the operator is looking at - but it is not a count of
// zero stream routes either, and the caller has to be able to tell.
func parseServiceRouteCounts(routes, streamRoutes []byte) (serviceRouteCounts, bool, error) {
	counts := serviceRouteCounts{}

	if err := countServiceIDs(routes, counts, func(c *routeCount) { c.Routes++ }); err != nil {
		return nil, false, err
	}

	if len(streamRoutes) == 0 {
		return counts, false, nil
	}
	if err := countServiceIDs(streamRoutes, counts, func(c *routeCount) { c.StreamRoutes++ }); err != nil {
		log.Printf("could not read the stream route listing, it will not be counted: %v", err)
		return counts, false, nil
	}
	return counts, true, nil
}

// countServiceIDs adds one row's worth to the count of every service named in a
// listing.
func countServiceIDs(body []byte, counts serviceRouteCounts, add func(*routeCount)) error {
	return countReferences(body, "service_id", func(id string) {
		count := counts[id]
		add(&count)
		counts[id] = count
	})
}

// countReferences calls add with the id each row of a listing names in field,
// once per row naming one.
//
// `list` is decoded loosely for the same reason parseServiceUpstreams does it:
// APISIX answers an empty collection with an object rather than an array, and
// insisting on an array would turn "this gateway has no routes" into an error.
func countReferences(body []byte, field string, add func(id string)) error {
	if len(body) == 0 {
		return nil
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	list, ok := payload["list"]
	if !ok {
		// Every APISIX collection answers with a `list`. A body without one is
		// a shape this cannot read, and reporting zero for it would be the
		// reading that gets a service deleted.
		return fmt.Errorf("no list in the response")
	}

	rows, ok := list.([]any)
	if !ok {
		return nil
	}

	for _, row := range rows {
		entry, ok := row.(map[string]any)
		if !ok {
			continue
		}
		value, ok := entry["value"].(map[string]any)
		if !ok {
			continue
		}
		// idField normalises the numeric ids APISIX keeps as numbers, so a
		// resource created with one is not counted as a second resource.
		id := idField(value, field)
		if id == "" {
			continue
		}
		add(id)
	}
	return nil
}
