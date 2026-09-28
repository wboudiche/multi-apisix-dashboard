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
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// MaxConcurrentProbes is how many connection tests and route tests the
// dashboard runs at once, and MaxConcurrentWsdlFetches how many WSDL imports.
//
// These are the endpoints that have the dashboard open connections from its own
// address on a caller's behalf. Who may ask is RequireResourcePermission's
// answer (#307) and one connection test is capped at 100 nodes (#305), but
// nothing bounded how many requests a caller sent: fifty of them started five
// thousand lookups and dials, each up to five seconds, from the dashboard's
// address (#310).
//
// Two buckets rather than one, because the hold times are not comparable: a
// connection test is bounded by its own budget of twenty seconds, while a WSDL
// import follows up to twenty documents at ten seconds each. Sharing one bucket
// let the slow endpoint refuse the quick ones for minutes.
//
// Neither number is the ceiling on the resource - that is probeDialSlots in the
// handlers, on the connections themselves. These bound how many callers are
// served at once, so that a burst is refused at the door rather than queued
// inside.
const (
	MaxConcurrentProbes      = 16
	MaxConcurrentWsdlFetches = 4
)

// How long a refused caller is told to wait on each bucket: the order of a real
// hold there. A connection test is bounded by its own twenty-second budget; a
// WSDL import follows up to twenty documents at ten seconds each, and on that
// bucket a share of one is given back only by the caller's own fetch.
const (
	ProbeRetryAfter = 5 * time.Second
	WsdlRetryAfter  = 30 * time.Second
)

// callerShare is how much of a bucket is kept for a caller that is not already
// holding that much: a quarter of it, and never less than one.
//
// The ceilings bound what the dashboard spends. Nothing bounded what one account
// spent of it, so a single developer looping a probe held every slot and left
// every other operator - super admins on unrelated instances included - refused
// on all three endpoints. That does not exhaust the host any more, which is what
// #310 was about; it hands the cost to the other people (#331).
//
// A quarter, rather than a number of its own, so that the two buckets keep their
// proportions: four of the sixteen quick probes, one of the four WSDL imports.
func callerShare(max int) int {
	if share := max / 4; share > 0 {
		return share
	}
	return 1
}

// The refusals, named so the UI can say which one it was in the operator's
// language: the dashboard is busy, or this account already holds its share of a
// bucket that is.
const (
	probeLimitAllCode    = "probe_limit_all"
	probeLimitCallerCode = "probe_limit_caller"
)

// probeBucket is a ceiling, and a share of it kept back once it is busy.
type probeBucket struct {
	mu       sync.Mutex
	inFlight int
	perUser  map[string]int
	max      int
	share    int
	// busyFrom is where the share starts to apply: with the last share slots
	// left, they are for callers who are not already holding that many.
	busyFrom   int
	retryAfter string
}

func newProbeBucket(max int, retryAfter time.Duration) *probeBucket {
	if max < 1 {
		// A wiring mistake, not a runtime condition: a bucket of none refuses
		// every request, and clamping it to one would hide that in production
		// behind an endpoint that merely felt slow.
		panic("middleware: a probe bucket needs a ceiling of at least one")
	}
	share := callerShare(max)
	return &probeBucket{
		perUser:    make(map[string]int),
		max:        max,
		share:      share,
		busyFrom:   max - share,
		retryAfter: strconv.Itoa(int(retryAfter.Seconds())),
	}
}

// take reports whether the request may run, and why not when it may not.
func (b *probeBucket) take(user string) (ok bool, code string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.inFlight >= b.max {
		return false, probeLimitAllCode
	}
	// Under the mark, whoever asks gets the slot: a ceiling nobody else is using
	// is not one to hold an operator under. A quiet dashboard lets one account
	// use what the dashboard can afford, which is what the ceiling was chosen to
	// be (#310), and only the last slots are kept for somebody else.
	if b.inFlight >= b.busyFrom && b.perUser[user] >= b.share {
		return false, probeLimitCallerCode
	}
	b.inFlight++
	b.perUser[user]++
	return true, ""
}

func (b *probeBucket) give(user string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Guarded rather than trusted: the channel this replaced could not go
	// negative, and a count that did would raise the bucket's real ceiling for
	// the life of the process with nothing saying so.
	if held := b.perUser[user]; held > 0 {
		b.inFlight--
		// Dropped at zero: the map would otherwise keep a counter for every
		// account that ever probed, which is a slow leak on a dashboard that
		// runs for months.
		if held == 1 {
			delete(b.perUser, user)
		} else {
			b.perUser[user] = held - 1
		}
	}
}

// LimitProbes refuses a probe request beyond the given number in flight, and -
// once that number is nearly reached - beyond one account's share of it.
//
// A refusal rather than a queue: the caller is a person waiting on an answer,
// and a queue would hold the dashboard's own connections while they waited -
// which is the resource this exists to protect. 429 with Retry-After says to
// come back, and the UI translates it.
//
// retryAfter is what a refused caller is told to wait, which is the order of a
// real hold on that bucket: a connection test is bounded by its twenty-second
// budget, a WSDL import can legitimately follow twenty documents at ten seconds
// each. One second would turn a refusal into a retry loop through every check in
// front of this one.
//
// Each call returns a handler with a bucket of its own, so routes that are to
// share one must share the handler the call returns.
func LimitProbes(max int, retryAfter time.Duration) gin.HandlerFunc {
	bucket := newProbeBucket(max, retryAfter)
	return func(c *gin.Context) {
		// The caller, as AuthMiddleware left it. An account that somehow
		// carries none counts as one caller rather than as none: an exemption
		// here would be the hole this closes.
		user := GetUserID(c)

		ok, code := bucket.take(user)
		if !ok {
			c.Header("Retry-After", bucket.retryAfter)
			// The frontend answers a 429 from these endpoints with a sentence
			// of its own, in the operator's language; this is for everything
			// else that reads the API.
			message := "The dashboard is already running as many outbound tests as it allows at once. Try again in a moment."
			if code == probeLimitCallerCode {
				message = "You already have as many outbound tests running as one account may while the dashboard is busy. Wait for one to finish."
			}
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": message,
				"code":  code,
			})
			return
		}
		defer bucket.give(user)
		c.Next()
	}
}
