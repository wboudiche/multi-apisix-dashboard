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

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// A probe request has the dashboard open connections from its own address.
// Nothing bounded how many ran at once: fifty requests of a hundred nodes
// started five thousand lookups and dials (#310).

// newProbeRouter serves /probe behind the limiter, with a handler that waits
// for release before answering, so a test can hold requests in flight.
func newProbeRouter(t *testing.T, max int, release <-chan struct{}) (*gin.Engine, <-chan struct{}) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	entered := make(chan struct{}, 64)
	r := gin.New()
	r.POST("/probe", LimitProbes(max), func(c *gin.Context) {
		entered <- struct{}{}
		<-release
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r, entered
}

func post(r *gin.Engine) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/probe", nil))
	return w
}

func TestLimitProbesRefusesBeyondTheCeiling(t *testing.T) {
	release := make(chan struct{})
	r, entered := newProbeRouter(t, 1, release)

	held := make(chan *httptest.ResponseRecorder, 1)
	go func() { held <- post(r) }()

	// In flight, so the only slot is taken.
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the first request never reached the handler")
	}

	refused := post(r)
	if refused.Code != http.StatusTooManyRequests {
		t.Errorf("second request: status %d, want %d", refused.Code, http.StatusTooManyRequests)
	}
	if got := refused.Header().Get("Retry-After"); got == "" {
		t.Error("second request: no Retry-After, so nothing says to come back")
	}
	// Refused, not run: the handler was never entered a second time.
	select {
	case <-entered:
		t.Error("the refused request reached the handler")
	default:
	}

	close(release)
	if first := <-held; first.Code != http.StatusOK {
		t.Errorf("first request: status %d, want %d", first.Code, http.StatusOK)
	}
}

func TestLimitProbesLetsTheNextOneThroughOnceTheFirstIsDone(t *testing.T) {
	release := make(chan struct{})
	close(release) // nothing is held: each request answers at once
	r, _ := newProbeRouter(t, 1, release)

	for i := range 3 {
		if w := post(r); w.Code != http.StatusOK {
			t.Fatalf("request %d: status %d, want %d - a slot was not released", i+1, w.Code, http.StatusOK)
		}
	}
}

// The ceiling is the number of requests, so max of them are in flight at once
// and the next one is refused rather than queued behind them.
func TestLimitProbesHoldsExactlyItsCeiling(t *testing.T) {
	const max = 3
	release := make(chan struct{})
	r, entered := newProbeRouter(t, max, release)

	for i := 0; i < max; i++ {
		go func() { post(r) }()
	}
	for i := 0; i < max; i++ {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d of %d requests reached the handler", i, max)
		}
	}

	if w := post(r); w.Code != http.StatusTooManyRequests {
		t.Errorf("request %d: status %d, want %d", max+1, w.Code, http.StatusTooManyRequests)
	}
	close(release)
}

func TestLimitProbesFloorsItsCeilingAtOne(t *testing.T) {
	// A misconfigured zero would otherwise refuse everything, closing the
	// endpoints rather than bounding them.
	release := make(chan struct{})
	close(release)
	r, _ := newProbeRouter(t, 0, release)

	if w := post(r); w.Code != http.StatusOK {
		t.Errorf("status %d, want %d", w.Code, http.StatusOK)
	}
}
