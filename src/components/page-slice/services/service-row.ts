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
import type { APISIXType } from '@/types/schema/apisix';

/**
 * A service list row, with what the proxy counted for it.
 *
 * Neither field is part of an APISIX service, so they are declared here rather
 * than in the schema - and here rather than in either page, because the table
 * and the cards show the same number (#277).
 *
 * `__route_count` absent means the proxy could not count, which the list says
 * with a banner rather than with a zero: a service nothing depends on is safe
 * to delete, and one whose dependants could not be counted is not.
 * `__stream_route_count` is absent when there are none.
 */
export type ServiceRow = APISIXType['RespServiceItem'] & {
  value: { __route_count?: number; __stream_route_count?: number };
};
