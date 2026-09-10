/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package handlers

import (
	"sync"
	"time"
)

// serviceUpstreamCacheTTL is how long a service table is reused.
//
// The upstream filter needs the whole table to answer for routes bound through
// a service, and it needed it once per page: an operator paging through an
// incident query re-read every service on the gateway on each turn, serialised
// ahead of the rows.
//
// Short on purpose. The question being answered is "which routes reach this
// upstream, right now", so the window has to be smaller than the attention span
// of the person asking. A service repointed inside it is stale for seconds
// rather than for a session, and the next page after that reads it fresh.
const serviceUpstreamCacheTTL = 10 * time.Second

type serviceUpstreamEntry struct {
	services map[string]string
	storedAt time.Time
}

// serviceUpstreamCache holds one service table per instance, briefly.
//
// Keyed by instance because the tables are unrelated: two gateways share no
// service ids, and answering one from the other's entry would resolve routes
// against upstreams that do not exist on it.
type serviceUpstreamCache struct {
	mu      sync.RWMutex
	entries map[string]serviceUpstreamEntry
	now     func() time.Time
}

func newServiceUpstreamCache(now func() time.Time) *serviceUpstreamCache {
	return &serviceUpstreamCache{
		entries: make(map[string]serviceUpstreamEntry),
		now:     now,
	}
}

// get returns the table held for an instance, if it is still fresh.
//
// A gateway with no services at all is a real answer rather than a miss, so the
// second return value carries presence instead of the map being non-empty.
func (c *serviceUpstreamCache) get(instanceID string) (map[string]string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[instanceID]
	if !ok || c.now().Sub(entry.storedAt) >= serviceUpstreamCacheTTL {
		return nil, false
	}
	return entry.services, true
}

func (c *serviceUpstreamCache) put(instanceID string, services map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[instanceID] = serviceUpstreamEntry{services: services, storedAt: c.now()}
}

// forget drops an instance's table.
//
// Called when this handler proxies a write to that instance's services: it is
// the one place that sees the change, so the window can be closed rather than
// waited out. Nothing fails in that window — the answer is simply wrong — so no
// warning would have told the operator either.
func (c *serviceUpstreamCache) forget(instanceID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.entries, instanceID)
}
