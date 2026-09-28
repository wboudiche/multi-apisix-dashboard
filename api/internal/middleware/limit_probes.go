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

// LimitProbes refuses a probe request beyond the given number in flight.
//
// A refusal rather than a queue: the caller is a person waiting on an answer,
// and a queue would hold the dashboard's own connections while they waited -
// which is the resource this exists to protect. 429 with Retry-After says to
// come back, and the UI translates it.
//
// Each call returns a handler with a bucket of its own, so routes that are to
// share one must share the handler the call returns.
func LimitProbes(max int) gin.HandlerFunc {
	inFlight := make(chan struct{}, max)
	return func(c *gin.Context) {
		select {
		case inFlight <- struct{}{}:
			defer func() { <-inFlight }()
			c.Next()
		default:
			c.Header("Retry-After", probeRetryAfterSeconds)
			// The frontend answers a 429 from these endpoints with a sentence
			// of its own, in the operator's language; this is for everything
			// else that reads the API.
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "The dashboard is already running as many outbound tests as it allows at once. Try again in a moment.",
			})
		}
	}
}
