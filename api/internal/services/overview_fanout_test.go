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
	"net"
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
// the connections it was given, and holding each request for hold.
func gatewayFor(t *testing.T, hold time.Duration) (*httptest.Server, *atomic.Int64, func() int) {
	t.Helper()

	var requests atomic.Int64
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		time.Sleep(hold)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"total":1}`)
	}))

	var mu sync.Mutex
	open, peak := 0, 0
	srv.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		mu.Lock()
		defer mu.Unlock()
		switch state {
		case http.StateNew:
			open++
			if open > peak {
				peak = open
			}
		case http.StateClosed, http.StateHijacked:
			open--
		}
	}
	srv.Start()
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
	gateway, requests, _ := gatewayFor(t, 50*time.Millisecond)
	service := NewOverviewService(nil, nil)
	service.instanceService = stubLister{instances: instancesPointingAt(gateway.URL, 2)}

	const callers = 25
	var wg sync.WaitGroup
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := service.RefreshOverview(context.Background(), "u", "super_admin", ""); err != nil {
				t.Errorf("refresh: %v", err)
			}
		}()
	}
	wg.Wait()

	// Two instances, three counts each: one read, not twenty-five of them.
	const perRead = 2 * 3
	if got := requests.Load(); got > perRead {
		t.Errorf("%d Admin API requests for %d callers, want %d - the reads did not collapse into one", got, callers, perRead)
	}
	if got := requests.Load(); got < perRead {
		t.Errorf("%d Admin API requests, want %d: the read did not happen", got, perRead)
	}
}

// And one read of a large estate stays inside the dashboard's ceiling on
// outbound connections, which is what the endpoint was outside of.
func TestRefreshOverviewStaysInsideTheConnectionCeiling(t *testing.T) {
	gateway, _, peakConns := gatewayFor(t, 20*time.Millisecond)
	service := NewOverviewService(nil, nil)
	// More instances than there are slots, so a fan-out that ignored the
	// ceiling would open more connections than it allows.
	service.instanceService = stubLister{instances: instancesPointingAt(gateway.URL, probe.Slots+16)}

	if _, err := service.RefreshOverview(context.Background(), "u", "super_admin", ""); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	if got := peakConns(); got > probe.Slots {
		t.Errorf("%d connections at once, want at most %d", got, probe.Slots)
	}
	if got := peakConns(); got < 2 {
		t.Errorf("peak of %d: the instances were read one at a time, so this pins nothing", got)
	}
}
