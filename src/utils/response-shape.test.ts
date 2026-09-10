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
import { describe, expect, it } from 'vitest';

import { assertJsonBody, MalformedResponseError } from './response-shape';

const URL = '/api/v1/teams';

describe('assertJsonBody', () => {
  it('passes the shapes an endpoint can actually answer with', () => {
    expect(() => assertJsonBody([], URL)).not.toThrow();
    expect(() => assertJsonBody([{ id: 'a' }], URL)).not.toThrow();
    expect(() => assertJsonBody({ list: [] }, URL)).not.toThrow();
    // JSON null is a value an endpoint may legitimately send.
    expect(() => assertJsonBody(null, URL)).not.toThrow();
  });

  it('passes a body-less success', () => {
    // A 204, or a DELETE answering 200 with nothing, reaches axios as an empty
    // string. Rejecting every string would turn every successful delete in the
    // dashboard into an error.
    expect(() => assertJsonBody('', URL)).not.toThrow();
    expect(() => assertJsonBody(undefined, URL)).not.toThrow();
  });

  it('rejects the SPA index that a misrouted proxy answers with', () => {
    // The real shape of the bug: /api/* forwarded to the static handler comes
    // back 200 with text/html, and axios leaves the raw body as a string.
    expect(() =>
      assertJsonBody('<!doctype html><html><body>index</body></html>', URL)
    ).toThrow(MalformedResponseError);
  });

  it('rejects a body that parsed into a bare string', () => {
    // The other way the same misroute arrives: the body happens to be valid
    // JSON — a quoted string — so axios parses it and hands over a string.
    // A string has a length and indexes, so it survives far enough to be
    // mistaken for a list.
    expect(() => assertJsonBody('<!doctype html>', URL)).toThrow(
      MalformedResponseError
    );
  });

  it('says which request it was, because one endpoint of many is misrouted', () => {
    expect(() => assertJsonBody('<!doctype html>', '/api/v1/instances')).toThrow(
      /\/api\/v1\/instances/
    );
  });
});
