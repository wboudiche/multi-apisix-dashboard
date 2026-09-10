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

import { MalformedResponseError } from '@/utils/response-shape';

/**
 * A record: an object that is not an array.
 *
 * Declared as a type predicate so `every` below actually narrows — without it
 * the return needs an unchecked cast, which would keep compiling if this check
 * were ever weakened.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A list response as a list, or a failure saying it was not one.
 *
 * axios resolves any 2xx, so a proxy answering /api/* with the SPA's own
 * index.html reaches a caller as success. Consumers then treat it as the list
 * they asked for — a string has a length, so it reads as N entries, and the
 * first `.map` or `.some` over it throws. For InstanceGuard that took the whole
 * dashboard down (#153); for the header's loader it was the same input (#150).
 *
 * Checked here rather than at each consumer, because that approach did not
 * converge: hardening the header left the guard, hardening the guard left the
 * instances page one click away behind its own empty-state button.
 *
 * It throws rather than answering with an empty or shortened list. Returning []
 * would trade a crash for a silent lie — "there are no instances" and "the
 * response was unreadable" would look the same, and the header would stop
 * telling the operator which one it hit. Dropping odd entries would be that
 * same lie one level down, and one of these lists is an authorization list:
 * getUserInstances feeds usePermission, which falls back to the broader global
 * role when the per-instance record is missing, so a quietly dropped entry
 * widens what someone may do. A caller that genuinely wants to degrade can
 * still catch.
 *
 * The array is returned as it came, not copied: these feed jotai atoms and
 * react-query caches, where a fresh array on every call is a re-render on
 * every call.
 */
export const parseRecordList = <T>(value: unknown): T[] => {
  if (!Array.isArray(value)) {
    throw new MalformedResponseError(
      `expected a list, got ${value === null ? 'null' : typeof value}`
    );
  }
  if (!value.every(isRecord)) {
    throw new MalformedResponseError('expected a list of records');
  }
  return value as T[];
};
