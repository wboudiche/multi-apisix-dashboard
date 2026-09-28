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
	"sync"

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

// probeRetryAfterSeconds is what a refused caller is told to wait. It is the
// order of a real hold - a connection test's budget is twenty seconds - rather
// than one second, which would turn a refusal into a retry loop through every
// check in front of this one.
const probeRetryAfterSeconds = "5"

// callerShare is how much of a bucket one account may hold: a quarter of it, and
// never less than one.
//
// The ceilings bound what the dashboard spends. Nothing bounded what one account
// spent of it, so a single developer looping a probe held every slot and left
// every other operator - super admins on unrelated instances included - refused
// on all three endpoints. That does not exhaust the host any more, which is what
// #310 was about; it hands the cost to the other people (#331).
//
// A quarter, rather than a number of its own, so that the two buckets keep their
// proportions: four of the sixteen quick probes, one of the four WSDL imports -
// which is one page action each, and the Test Connection button sends its
// batches one after another rather than at once.
func callerShare(max int) int {
	if share := max / 4; share > 0 {
		return share
	}
	return 1
}

// The refusals, named so the UI can say which one it was in the operator's
// language: the dashboard is busy, or this account already holds its share.
const (
	probeLimitAllCode    = "probe_limit_all"
	probeLimitCallerCode = "probe_limit_caller"
)

// probeBucket is a ceiling and, within it, each caller's share.
type probeBucket struct {
	mu       sync.Mutex
	inFlight int
	perUser  map[string]int
	max      int
	share    int
}

func newProbeBucket(max int) *probeBucket {
	if max < 1 {
		max = 1
	}
	return &probeBucket{
		perUser: make(map[string]int),
		max:     max,
		share:   callerShare(max),
	}
}

// take reports whether the request may run, and why not when it may not.
func (b *probeBucket) take(user string) (ok bool, code string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.perUser[user] >= b.share {
		return false, probeLimitCallerCode
	}
	if b.inFlight >= b.max {
		return false, probeLimitAllCode
	}
	b.inFlight++
	b.perUser[user]++
	return true, ""
}

func (b *probeBucket) give(user string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.inFlight--
	// Dropped at zero: the map would otherwise keep a counter for every account
	// that ever probed, which is a slow leak on a long-running dashboard.
	if b.perUser[user] <= 1 {
		delete(b.perUser, user)
		return
	}
	b.perUser[user]--
}

// LimitProbes refuses a probe request beyond the given number in flight, and
// beyond one account's share of that number.
//
// A refusal rather than a queue: the caller is a person waiting on an answer,
// and a queue would hold the dashboard's own connections while they waited -
// which is the resource this exists to protect. 429 with Retry-After says to
// come back, and the UI translates it.
//
// Each call returns a handler with a bucket of its own, so routes that are to
// share one must share the handler the call returns.
func LimitProbes(max int) gin.HandlerFunc {
	bucket := newProbeBucket(max)
	return func(c *gin.Context) {
		// The caller, as AuthMiddleware left it. An account that somehow
		// carries none counts as one caller rather than as none: an exemption
		// here would be the hole this closes.
		user := GetUserID(c)

		ok, code := bucket.take(user)
		if !ok {
			c.Header("Retry-After", probeRetryAfterSeconds)
			// The frontend answers a 429 from these endpoints with a sentence
			// of its own, in the operator's language; this is for everything
			// else that reads the API.
			message := "The dashboard is already running as many outbound tests as it allows at once. Try again in a moment."
			if code == probeLimitCallerCode {
				message = "You already have as many outbound tests running as one account may. Wait for one to finish."
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
