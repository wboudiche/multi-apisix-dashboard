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
	"testing"
	"time"
)

// Paging through an upstream-filtered list re-read the whole service table once
// per page. The window is deliberately short: the question being answered is
// "which routes reach this upstream, right now", so a service repointed during
// it is stale for seconds rather than for a session.
func TestServiceUpstreamCache(t *testing.T) {
	now := time.Unix(0, 0)
	cache := newServiceUpstreamCache(func() time.Time { return now })

	t.Run("an unseen instance is a miss", func(t *testing.T) {
		if _, ok := cache.get("inst-a"); ok {
			t.Error("expected a miss before anything was stored")
		}
	})

	t.Run("a stored table answers within the window", func(t *testing.T) {
		cache.put("inst-a", map[string]string{"svc": "up"})
		now = now.Add(serviceUpstreamCacheTTL - time.Millisecond)

		got, ok := cache.get("inst-a")
		if !ok {
			t.Fatal("expected a hit inside the window")
		}
		if got["svc"] != "up" {
			t.Errorf("got %v, want svc -> up", got)
		}
	})

	t.Run("and stops answering once it is past", func(t *testing.T) {
		now = now.Add(2 * time.Millisecond)
		if _, ok := cache.get("inst-a"); ok {
			t.Error("expected a miss once the entry aged out")
		}
	})

	t.Run("one instance never answers for another", func(t *testing.T) {
		cache.put("inst-a", map[string]string{"svc": "up-a"})
		if _, ok := cache.get("inst-b"); ok {
			t.Error("inst-b must not be answered from inst-a's entry")
		}
	})

	t.Run("an empty table is a real answer, not a miss", func(t *testing.T) {
		// A gateway with no services at all still has a known answer, and
		// re-reading it on every page would defeat the point.
		cache.put("inst-empty", map[string]string{})
		if _, ok := cache.get("inst-empty"); !ok {
			t.Error("expected a hit for a gateway with no services")
		}
	})
}

// The handler is concurrent; run with -race.
func TestServiceUpstreamCacheIsSafeForConcurrentUse(t *testing.T) {
	cache := newServiceUpstreamCache(time.Now)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); cache.put("inst", map[string]string{"s": "u"}) }()
		go func() { defer wg.Done(); cache.get("inst") }()
	}
	wg.Wait()
}

// The handler that answers the filter is also the one that writes services, so
// it knows the moment the table it is holding stops being true. Repointing a
// service through the dashboard and immediately filtering by the new upstream
// used to answer from the stale map for the rest of the window — and nothing
// failed, so no warning said so either.
func TestServiceUpstreamCacheForgetsOneInstance(t *testing.T) {
	cache := newServiceUpstreamCache(time.Now)
	cache.put("inst-a", map[string]string{"svc": "up-a"})
	cache.put("inst-b", map[string]string{"svc": "up-b"})

	cache.forget("inst-a")

	if _, ok := cache.get("inst-a"); ok {
		t.Error("the instance that was written to should have been dropped")
	}
	if _, ok := cache.get("inst-b"); !ok {
		t.Error("another instance's table has nothing to do with that write")
	}

	t.Run("forgetting something unheld is not an error", func(t *testing.T) {
		cache.forget("never-seen")
	})
}
