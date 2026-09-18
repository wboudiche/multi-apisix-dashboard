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

// instanceCache holds one table per instance, briefly.
//
// Keyed by instance because the tables are unrelated: two gateways share no
// service ids, and answering one from the other's entry would resolve routes
// against upstreams that do not exist on it.
//
// Two of these exist, for the service table the upstream filter reads and for
// the route counts the service list shows; they are the same cache with
// different contents, so they are the same type.
type instanceCache[T any] struct {
	mu      sync.RWMutex
	entries map[string]instanceCacheEntry[T]
	now     func() time.Time
	ttl     time.Duration
}

type instanceCacheEntry[T any] struct {
	value    T
	storedAt time.Time
}

func newInstanceCache[T any](now func() time.Time, ttl time.Duration) *instanceCache[T] {
	return &instanceCache[T]{
		entries: make(map[string]instanceCacheEntry[T]),
		now:     now,
		ttl:     ttl,
	}
}

// get returns what is held for an instance, if it is still fresh.
//
// A gateway with no services at all is a real answer rather than a miss, so the
// second return value carries presence instead of the table being non-empty.
func (c *instanceCache[T]) get(instanceID string) (T, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[instanceID]
	if !ok || c.now().Sub(entry.storedAt) >= c.ttl {
		var zero T
		return zero, false
	}
	return entry.value, true
}

func (c *instanceCache[T]) put(instanceID string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[instanceID] = instanceCacheEntry[T]{value: value, storedAt: c.now()}
}

// forget drops an instance's entry.
//
// Called when this handler proxies a write that makes it untrue: it is the one
// place that sees the change, so the window can be closed rather than waited
// out. Nothing fails in that window — the answer is simply wrong — so no
// warning would have told the operator either.
func (c *instanceCache[T]) forget(instanceID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.entries, instanceID)
}
