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
 * A 2xx whose body cannot be what the endpoint promised.
 *
 * Named, rather than a bare TypeError, because callers act on it: InstanceGuard
 * declines to retry it (a misroute does not heal in 7 seconds) and says
 * something different for it than for an empty list. Using the native type as
 * that signal also meant any accidental TypeError from an interceptor would be
 * read as "malformed body, do not retry".
 */
export class MalformedResponseError extends Error {
  /** The request, when the thrower knew it. Absent from the shape checks,
   *  which run on a value that has already left its response behind. */
  readonly url?: string;

  constructor(detail: string, url?: string) {
    super(url ? `${url}: ${detail}` : detail);
    this.name = 'MalformedResponseError';
    this.url = url;
  }
}

/**
 * Reject a success that cannot be one.
 *
 * A proxy that forwards /api/* to the static handler answers 200 with the SPA's
 * own index.html. axios resolves any 2xx, so that reaches the caller as
 * success, and a string survives long enough to be mistaken for the thing that
 * was asked for: it has a length, so it reads as N entries, and the first `.map`
 * or `.some` over it throws somewhere with no idea what happened. Where the
 * caller reaches for a field instead of iterating — `data.list || []`,
 * `data.value` — nothing throws at all and the answer is "there are none".
 *
 * Every endpoint behind both clients answers JSON: an object, an array, or
 * nothing. None of them answers with a string, and no caller reads one — so a
 * non-empty string body is that misroute and nothing else.
 *
 * This is deliberately the only thing checked here. Per-endpoint shape is a
 * different question with a different answer (`parseRecordList`), and it can
 * only be asked where the expected shape is known; this can be asked once, for
 * every endpoint, including the ones nobody has thought about yet.
 */
export const assertJsonBody = (data: unknown, url: string): void => {
  // A body-less success — 204, or a DELETE answering 200 with nothing — reaches
  // axios as an empty string. That is an answer, not a broken one.
  if (typeof data !== 'string' || data === '') return;

  throw new MalformedResponseError(
    `expected a JSON body, got ${data.length} characters of text`,
    url
  );
};
