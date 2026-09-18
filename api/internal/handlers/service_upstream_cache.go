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

import "time"

// serviceUpstreamCacheTTL is how long a service table is reused.
//
// The upstream filter needs the whole table to answer for routes bound through
// a service, and it needed it once per page: an operator paging through an
// incident query re-read every service on the gateway on each turn, serialised
// ahead of the rows.
//
// Short on purpose. The question being answered is "which routes reach this
// upstream, right now", so the window has to be smaller than the attention span
// of the person asking. A service repointed inside it is stale for seconds
// rather than for a session, and the next page after that reads it fresh.
const serviceUpstreamCacheTTL = 10 * time.Second

// serviceUpstreamCache holds one service table per instance, briefly.
type serviceUpstreamCache = instanceCache[serviceUpstreams]

func newServiceUpstreamCache(now func() time.Time) *serviceUpstreamCache {
	return newInstanceCache[serviceUpstreams](now, serviceUpstreamCacheTTL)
}
