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
	"encoding/json"
	"fmt"
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
	r.Use(withCaller)
	r.POST("/probe", LimitProbes(max, ProbeRetryAfter), func(c *gin.Context) {
		entered <- struct{}{}
		<-release
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r, entered
}

// withCaller stands in for AuthMiddleware: the request says who is asking, as a
// header here, because the limiter now weighs one caller's share as well as the
// whole bucket (#331).
func withCaller(c *gin.Context) {
	c.Set(UserIDKey, c.GetHeader("X-Test-Caller"))
	c.Next()
}

func postProbe(r *gin.Engine, path string, caller string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, nil)
	req.Header.Set("X-Test-Caller", caller)
	r.ServeHTTP(w, req)
	return w
}

// inBackground sends a request and hands back its answer, so that a test can
// assert on one that is expected to be refused without blocking on it if it is
// let through instead - which would hang rather than fail.
func inBackground(r *gin.Engine, path string, caller string) <-chan *httptest.ResponseRecorder {
	out := make(chan *httptest.ResponseRecorder, 1)
	go func() { out <- postProbe(r, path, caller) }()
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

	held := inBackground(r, "/probe", "u1")

	// In flight, so the only slot is taken.
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the first request never reached the handler")
	}

	// Sent in the background: a request that got through would wait on the
	// handler, and this way that reports a failure rather than hanging the test
	// until go test's own timeout.
	refused := answerWithin(t, inBackground(r, "/probe", "u2"), 2*time.Second)
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
		if w := postProbe(r, "/probe", "u1"); w.Code != http.StatusOK {
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

	// A caller each, so what fills the bucket is the bucket and not one
	// account's share of it.
	held := make([]<-chan *httptest.ResponseRecorder, 0, max)
	for i := range max {
		held = append(held, inBackground(r, "/probe", fmt.Sprintf("u%d", i)))
	}
	for i := range max {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d of %d requests reached the handler", i, max)
		}
	}

	// From a caller holding nothing: sent from one of the callers above, its own
	// share would answer first and this would not be about the ceiling at all.
	refused := answerWithin(t, inBackground(r, "/probe", "holds-nothing"), 2*time.Second)
	if refused.Code != http.StatusTooManyRequests {
		t.Errorf("request %d: status %d, want %d", max+1, refused.Code, http.StatusTooManyRequests)
	}
	if code := refusalCode(t, refused); code != probeLimitAllCode {
		t.Errorf("refused with %q, want %q: the bucket was full, not this caller's share", code, probeLimitAllCode)
	}
	if got := refused.Header().Get("Retry-After"); got != "5" {
		t.Errorf("Retry-After %q, want 5 seconds", got)
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

	shared := LimitProbes(1, ProbeRetryAfter)
	handler := func(c *gin.Context) {
		entered <- struct{}{}
		<-release
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
	r := gin.New()
	r.Use(withCaller)
	r.POST("/probe", shared, handler)
	r.POST("/other-probe", shared, handler)

	held := inBackground(r, "/probe", "u1")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the first request never reached the handler")
	}

	// Another caller, so what refuses it is the shared bucket and not a share.
	other := answerWithin(t, inBackground(r, "/other-probe", "u2"), 2*time.Second)
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
	r.Use(withCaller)
	r.POST("/probe", LimitProbes(1, ProbeRetryAfter), handler)
	r.POST("/wsdl", LimitProbes(1, WsdlRetryAfter), handler)

	held := inBackground(r, "/wsdl", "u1")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the WSDL request never reached the handler")
	}

	// The quick endpoint is not refused because the slow one is busy.
	quick := inBackground(r, "/probe", "u2")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the probe request was refused although its own bucket was free")
	}

	close(release)
	answerWithin(t, held, 2*time.Second)
	answerWithin(t, quick, 2*time.Second)
}

// refusalCode reads which refusal a 429 carried.
func refusalCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return body.Code
}

// A quiet bucket is not one to hold an operator under: alone on the dashboard,
// one account may take it up to where the reserve begins - more than its share -
// which is what the ceiling was chosen to allow (#310, #331).
func TestLimitProbesLetsOneCallerUseAQuietBucket(t *testing.T) {
	bucket := newProbeBucket(8, ProbeRetryAfter) // share 2, reserve from 6

	if bucket.busyFrom <= bucket.share {
		t.Fatalf("reserve begins at %d and the share is %d, so this pins nothing", bucket.busyFrom, bucket.share)
	}
	for i := range bucket.busyFrom {
		if ok, code := bucket.take("alone"); !ok {
			t.Fatalf("slot %d of %d: refused with %q, and nobody else was asking", i+1, bucket.busyFrom, code)
		}
	}
}

// Once the bucket is busy, what is left is for whoever is not already holding a
// share: the account that filled it waits, another is served. One account used
// to hold every slot and leave everybody else refused (#331).
func TestLimitProbesKeepsTheLastSlotsForSomebodyElse(t *testing.T) {
	const max = 8
	release := make(chan struct{})
	r, entered := newProbeRouter(t, max, release)

	busyFrom := max - callerShare(max)
	held := make([]<-chan *httptest.ResponseRecorder, 0, busyFrom)
	for range busyFrom {
		held = append(held, inBackground(r, "/probe", "greedy"))
	}
	for i := range busyFrom {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d of %d requests from one caller reached the handler", i, busyFrom)
		}
	}

	// Held to its share now, with room left in the bucket.
	refused := answerWithin(t, inBackground(r, "/probe", "greedy"), 2*time.Second)
	if refused.Code != http.StatusTooManyRequests {
		t.Errorf("the same caller again: status %d, want %d", refused.Code, http.StatusTooManyRequests)
	}
	if code := refusalCode(t, refused); code != probeLimitCallerCode {
		t.Errorf("refused with %q, want %q", code, probeLimitCallerCode)
	}

	// And that room is somebody else's, which is the whole point.
	other := inBackground(r, "/probe", "somebody-else")
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("another caller was refused although the bucket kept room for one")
	}

	close(release)
	for _, got := range held {
		answerWithin(t, got, 2*time.Second)
	}
	if w := answerWithin(t, other, 2*time.Second); w.Code != http.StatusOK {
		t.Errorf("the other caller: status %d, want %d", w.Code, http.StatusOK)
	}
}

// A slot given back is one the same caller may take again, and the counter is
// not left behind: the map would otherwise keep an entry for every account that
// ever probed.
func TestLimitProbesGivesACallerItsSlotsBack(t *testing.T) {
	bucket := newProbeBucket(8, ProbeRetryAfter)

	for i := range bucket.busyFrom {
		if ok, code := bucket.take("u1"); !ok {
			t.Fatalf("slot %d of %d: refused with %q", i+1, bucket.busyFrom, code)
		}
	}
	if ok, code := bucket.take("u1"); ok {
		t.Fatalf("slot %d was allowed past the reserve", bucket.busyFrom+1)
	} else if code != probeLimitCallerCode {
		t.Errorf("refused with %q, want %q", code, probeLimitCallerCode)
	}

	for range bucket.busyFrom {
		bucket.give("u1")
	}
	if got := len(bucket.perUser); got != 0 {
		t.Errorf("%d callers still counted, want 0: the counter outlived the requests", got)
	}
	if got := bucket.inFlight; got != 0 {
		t.Errorf("%d in flight, want 0", got)
	}
	if ok, code := bucket.take("u1"); !ok {
		t.Errorf("after giving them back: refused with %q", code)
	}
}

// A give without a take must not raise the bucket's real ceiling: the channel
// this replaced could not go negative, and this count must not either.
func TestLimitProbesDoesNotGiveBackWhatWasNotTaken(t *testing.T) {
	bucket := newProbeBucket(4, ProbeRetryAfter)

	bucket.give("never-asked")
	bucket.give("never-asked")
	if got := bucket.inFlight; got != 0 {
		t.Errorf("%d in flight after two spurious gives, want 0", got)
	}

	for i := range bucket.max {
		if ok, _ := bucket.take(fmt.Sprintf("u%d", i)); !ok {
			t.Fatalf("slot %d of %d was refused: the ceiling moved", i+1, bucket.max)
		}
	}
	if ok, code := bucket.take("one-more"); ok || code != probeLimitAllCode {
		t.Errorf("beyond the ceiling: ok %v, code %q", ok, code)
	}
}

func TestProbeBucketRefusesToBeBuiltWithoutACeiling(t *testing.T) {
	// A wiring mistake is not a runtime condition: clamped to one, it would
	// leave an endpoint that merely felt slow.
	defer func() {
		if recover() == nil {
			t.Error("newProbeBucket(0) did not panic")
		}
	}()
	newProbeBucket(0, ProbeRetryAfter)
}

func TestCallerShareIsAQuarterAndNeverNothing(t *testing.T) {
	for _, tt := range []struct{ max, want int }{
		{16, 4}, // the quick probes
		{8, 2},
		{4, 1}, // the WSDL imports: one page action each
		{3, 1},
		{1, 1},
	} {
		if got := callerShare(tt.max); got != tt.want {
			t.Errorf("callerShare(%d) = %d, want %d", tt.max, got, tt.want)
		}
	}
}
