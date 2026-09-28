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

func postProbe(r *gin.Engine, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, nil))
	return w
}

// inBackground sends a request and hands back its answer, so that a test can
// assert on one that is expected to be refused without blocking on it if it is
// let through instead - which would hang rather than fail.
func inBackground(r *gin.Engine, path string) <-chan *httptest.ResponseRecorder {
	out := make(chan *httptest.ResponseRecorder, 1)
	go func() { out <- postProbe(r, path) }()
	return out
}

func answerWithin(t *testing.T, got <-chan *httptest.ResponseRecorder, d time.Duration) *httptest.ResponseRecorder {
	t.Helper()
	select {
	case w := <-got:
		return w
	case <-time.After(d):
		t.Fatal("the request never answered: it was let through and is waiting on the handler")
		return nil
	}
}

func TestLimitProbesRefusesBeyondTheCeiling(t *testing.T) {
	release := make(chan struct{})
	r, entered := newProbeRouter(t, 1, release)

	held := inBackground(r, "/probe")

	// In flight, so the only slot is taken.
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the first request never reached the handler")
	}

	// Sent in the background: a request that got through would wait on the
	// handler, and this way that reports a failure rather than hanging the test
	// until go test's own timeout.
	refused := answerWithin(t, inBackground(r, "/probe"), 2*time.Second)
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
	if first := answerWithin(t, held, 2*time.Second); first.Code != http.StatusOK {
		t.Errorf("first request: status %d, want %d", first.Code, http.StatusOK)
	}
}

func TestLimitProbesLetsTheNextOneThroughOnceTheFirstIsDone(t *testing.T) {
	release := make(chan struct{})
	close(release) // nothing is held: each request answers at once
	r, _ := newProbeRouter(t, 1, release)

	for i := range 3 {
		if w := postProbe(r, "/probe"); w.Code != http.StatusOK {
			t.Fatalf("request %d: status %d, want %d - a slot was not released", i+1, w.Code, http.StatusOK)
		}
	}
}

// The ceiling is a number of requests, so max of them run at once, each
// answering 200, and the next one is refused rather than queued behind them.
func TestLimitProbesHoldsExactlyItsCeiling(t *testing.T) {
	const max = 3
	release := make(chan struct{})
	r, entered := newProbeRouter(t, max, release)

	held := make([]<-chan *httptest.ResponseRecorder, 0, max)
	for range max {
		held = append(held, inBackground(r, "/probe"))
	}
	for i := range max {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d of %d requests reached the handler", i, max)
		}
	}

	refused := answerWithin(t, inBackground(r, "/probe"), 2*time.Second)
	if refused.Code != http.StatusTooManyRequests {
		t.Errorf("request %d: status %d, want %d", max+1, refused.Code, http.StatusTooManyRequests)
	}

	// The admitted ones answered, which the count of requests that entered the
	// handler says nothing about.
	close(release)
	for i, got := range held {
		if w := answerWithin(t, got, 2*time.Second); w.Code != http.StatusOK {
			t.Errorf("held request %d: status %d, want %d", i+1, w.Code, http.StatusOK)
		}
	}
}

// One handler, one bucket: the routes that are to share a ceiling share the
// handler the call returns. Mounting LimitProbes per route would multiply the
// ceiling by the number of routes, which no test saw.
func TestLimitProbesIsOneBucketAcrossTheRoutesThatShareIt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	release := make(chan struct{})
	entered := make(chan struct{}, 4)

	shared := LimitProbes(1)
	handler := func(c *gin.Context) {
		entered <- struct{}{}
		<-release
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
	r := gin.New()
	r.POST("/probe", shared, handler)
	r.POST("/other-probe", shared, handler)

	held := inBackground(r, "/probe")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the first request never reached the handler")
	}

	other := answerWithin(t, inBackground(r, "/other-probe"), 2*time.Second)
	if other.Code != http.StatusTooManyRequests {
		t.Errorf("the second route: status %d, want %d - it has a bucket of its own", other.Code, http.StatusTooManyRequests)
	}

	close(release)
	answerWithin(t, held, 2*time.Second)
}

// A bucket of its own for the endpoint whose hold time is not comparable: a
// WSDL import can legitimately hold one for minutes, and sharing meant it
// refused the quick tests for that long.
func TestLimitProbesGivesEachCallItsOwnBucket(t *testing.T) {
	gin.SetMode(gin.TestMode)
	release := make(chan struct{})
	entered := make(chan struct{}, 4)

	handler := func(c *gin.Context) {
		entered <- struct{}{}
		<-release
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
	r := gin.New()
	r.POST("/probe", LimitProbes(1), handler)
	r.POST("/wsdl", LimitProbes(1), handler)

	held := inBackground(r, "/wsdl")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the WSDL request never reached the handler")
	}

	// The quick endpoint is not refused because the slow one is busy.
	quick := inBackground(r, "/probe")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the probe request was refused although its own bucket was free")
	}

	close(release)
	answerWithin(t, held, 2*time.Second)
	answerWithin(t, quick, 2*time.Second)
}
