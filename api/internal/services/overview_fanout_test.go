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

package services

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/probe"
)

// The overview reads every registered instance, three Admin API calls each, on
// a page any authenticated account can ask for. Nothing bounded how many of
// those reads ran at once (#330).

type stubLister struct {
	instances []*models.Instance
}

func (s stubLister) ListInstances(context.Context) ([]*models.Instance, error) {
	return s.instances, nil
}

// gatewayFor answers like an Admin API, counting the requests it was sent and
// how many it was serving at once, and holding each for hold.
//
// Concurrency is counted here rather than from the server's connection states:
// a slot is released when the client closes its connection, which the server
// learns of later, so a peak counted there can read one over the ceiling on a
// loaded machine without anything being wrong.
func gatewayFor(t *testing.T, hold time.Duration) (*httptest.Server, *atomic.Int64, func() int) {
	t.Helper()

	var requests atomic.Int64
	var mu sync.Mutex
	serving, peak := 0, 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		mu.Lock()
		serving++
		if serving > peak {
			peak = serving
		}
		mu.Unlock()

		time.Sleep(hold)

		mu.Lock()
		serving--
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"total":1}`)
	}))
	t.Cleanup(srv.Close)

	return srv, &requests, func() int {
		mu.Lock()
		defer mu.Unlock()
		return peak
	}
}

func instancesPointingAt(url string, n int) []*models.Instance {
	out := make([]*models.Instance, 0, n)
	for i := range n {
		out = append(out, &models.Instance{
			ID:          fmt.Sprintf("i-%d", i),
			Name:        fmt.Sprintf("gateway-%d", i),
			AdminAPIURL: url,
			AdminKey:    "k",
			IsActive:    true,
		})
	}
	return out
}

// Fifty requests arriving on a cold cache used to start fifty fan-outs. They
// share one read now: the answer does not depend on who asked.
func TestRefreshOverviewIsOneReadHoweverManyAsk(t *testing.T) {
	// Held long enough that every caller below has joined before the leader is
	// done: three sequential counts of 200ms apiece.
	gateway, requests, _ := gatewayFor(t, 200*time.Millisecond)
	service := NewOverviewService(nil, nil)
	service.instanceService = stubLister{instances: instancesPointingAt(gateway.URL, 2)}

	const callers = 25
	start := make(chan struct{})
	var wg sync.WaitGroup
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // every caller asks at once, not as it is scheduled
			if _, err := service.RefreshOverview(context.Background()); err != nil {
				t.Errorf("refresh: %v", err)
			}
		}()
	}
	close(start)
	wg.Wait()

	// Two instances, three counts each: one read, not twenty-five of them.
	const perRead = 2 * 3
	if got := requests.Load(); got != perRead {
		t.Errorf("%d Admin API requests for %d callers, want %d - the reads did not collapse into one", got, callers, perRead)
	}
}

// A caller that goes away must not take the read with it: the others are
// waiting on it, and the next thirty seconds of page loads are served from what
// it writes.
func TestRefreshOverviewSurvivesTheCallerThatStartedIt(t *testing.T) {
	gateway, _, _ := gatewayFor(t, 100*time.Millisecond)
	service := NewOverviewService(nil, nil)
	service.instanceService = stubLister{instances: instancesPointingAt(gateway.URL, 2)}

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	joined := make(chan *models.OverviewData, 1)
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		_, _ = service.RefreshOverview(leaderCtx) // this one leaves
	}()
	time.Sleep(20 * time.Millisecond) // the flight is under way
	go func() {
		defer wg.Done()
		data, err := service.RefreshOverview(context.Background())
		if err != nil {
			t.Errorf("the sharer got an error: %v", err)
			joined <- nil
			return
		}
		joined <- data
	}()

	time.Sleep(20 * time.Millisecond)
	cancelLeader()
	wg.Wait()

	data := <-joined
	if data == nil {
		t.Fatal("no data")
	}
	for _, health := range data.AllInstances {
		if health.Status != "Connected" {
			t.Errorf("%s: status %q (%s), want Connected - the leader leaving poisoned the read", health.Name, health.Status, health.Error)
		}
	}
}

// And one read of a large estate stays inside the overview's own share of the
// dashboard's connections, which is what the endpoint was outside of.
func TestRefreshOverviewStaysInsideItsCeiling(t *testing.T) {
	gateway, _, peakServing := gatewayFor(t, 20*time.Millisecond)
	service := NewOverviewService(nil, nil)
	// More instances than there are slots, so a fan-out that ignored the
	// ceiling would read more of them at once than it allows.
	service.instanceService = stubLister{instances: instancesPointingAt(gateway.URL, probe.OverviewSlots+16)}

	if _, err := service.RefreshOverview(context.Background()); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	if got := peakServing(); got > probe.OverviewSlots {
		t.Errorf("%d instances read at once, want at most %d", got, probe.OverviewSlots)
	}
	if got := peakServing(); got < 2 {
		t.Errorf("peak of %d: the instances were read one at a time, so this pins nothing", got)
	}
}
