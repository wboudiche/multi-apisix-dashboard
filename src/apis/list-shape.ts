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
 * Entries that are not records are dropped for the same reason `Array.isArray`
 * alone was not enough — `[null]` passed it and threw on the next line.
 *
 * It throws rather than answering with an empty list. Returning [] would trade
 * a crash for a silent lie: "there are no instances" and "the response was
 * unreadable" would look the same, and the header would stop telling the
 * operator which one it hit — the notification #150 exists for. A caller that
 * genuinely wants to degrade can still catch.
 *
 * The original array is returned when nothing had to be dropped: these feed
 * jotai atoms and react-query caches, where a fresh array on every call is a
 * re-render on every call.
 */
export const parseRecordList = <T>(value: unknown): T[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`expected a list, got ${value === null ? 'null' : typeof value}`);
  }

  const kept = value.filter(
    (entry) => entry !== null && typeof entry === 'object'
  );
  return (kept.length === value.length ? value : kept) as T[];
};
