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

// MaxConcurrentProbes is how many probe requests the dashboard runs at once,
// across the connection test, the route test and the WSDL fetch together.
//
// These are the endpoints that have the dashboard open connections from its own
// address on a caller's behalf. Who may ask is RequireResourcePermission's
// answer (#307) and one connection test is capped at 100 nodes (#305), but
// nothing bounded how many requests a caller sent: fifty of them started five
// thousand lookups and dials, each up to five seconds, from the dashboard's
// address (#310).
//
// Sixteen leaves room for a handful of operators probing at once, and for this
// repo's own e2e suite, which runs probe specs in parallel across shards. The
// number that matters is its product with the connection test's own ceiling:
// 128 outbound connections, whatever the traffic, rather than a limit per
// request and none on the requests.
const MaxConcurrentProbes = 16

// LimitProbes refuses a probe request beyond the given number in flight.
//
// A refusal rather than a queue: the caller is a person waiting on an answer,
// and a queue would hold the dashboard's own connections while they waited -
// which is the resource this exists to protect. 429 with Retry-After says to
// come back, and the UI shows the message.
func LimitProbes(max int) gin.HandlerFunc {
	if max < 1 {
		max = 1
	}
	inFlight := make(chan struct{}, max)
	return func(c *gin.Context) {
		select {
		case inFlight <- struct{}{}:
			defer func() { <-inFlight }()
			c.Next()
		default:
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "The dashboard is already running as many connection tests as it allows at once. Try again in a moment.",
			})
		}
	}
}
