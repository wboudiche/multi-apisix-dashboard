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
 * A resource as APISIX holds it, without the fields the proxy adds to list rows
 * for the dashboard's own use — `__team_id`, and on routes `__upstream_id` or
 * `__upstream_inline`.
 *
 * They are not part of the resource. Shown as if they were, an `__upstream_id`
 * reached through a service reads as an upstream the route names itself, and
 * an edit to it is dropped on save without a word. Only the top level carries
 * them, as the proxy's own strip assumes.
 */
export const withoutDashboardFields = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('__')));
