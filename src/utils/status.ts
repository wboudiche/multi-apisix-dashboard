/**
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

/**
 * Whether a resource carrying this `status` is live on the gateway.
 *
 * APISIX leaves `status` out entirely when it was never set, and an absent
 * status behaves exactly like `status: 1`. Probed against the data plane, where
 * 502 means the route matched and the (unreachable) upstream was tried, and 404
 * means it did not match at all:
 *
 *     no status  -> 502   # live
 *     status=0   -> 404   # disabled
 *     status=1   -> 502   # live
 *
 * Comparing `status === 1` therefore reported every route that had never been
 * explicitly published as disabled, while it was serving traffic. It also
 * disagreed with the dashboard's own list filter, which treats an absent status
 * as published (see matchesStatus in api/internal/handlers/list_filter.go) —
 * filtering by Published returned routes the table then labelled Unpublished.
 *
 * Only an explicit 0 disables.
 */
export const isResourceEnabled = (status?: number | null): boolean =>
  status !== 0;
