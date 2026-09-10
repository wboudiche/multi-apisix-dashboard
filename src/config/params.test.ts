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

import { serializeParams } from './params';

describe('serializeParams', () => {
  it('encodes the APISIX filter quirk', () => {
    expect(serializeParams({ filter: { service_id: 1 }, page: 1 })).toBe(
      'filter=service_id%3D1&page=1'
    );
  });

  it('repeats a list rather than bracketing it', () => {
    // `?label=a&label=b`, which is what the backend reads for the repeatable
    // filters added in #142.
    expect(serializeParams({ label: ['a', 'b'] })).toBe('label=a&label=b');
  });

  it('gives the same answer the second time it is asked', () => {
    // It used to write the encoded filter back into the object it was handed.
    // Asked again with the same object — which is exactly what an axios retry
    // does, since it reuses `err.config` — `p.filter` was already a string, and
    // qs.stringify of a string is ''. So the retry dropped the filter and the
    // caller was shown an unfiltered list as if it were the filtered one.
    //
    // The session refresh added in #168 made that deterministic: every renewal
    // retries, and every retry lost the filter. TanStack's own retries reached
    // it first.
    const params = { filter: { service_id: 1 }, page: 1 };

    const first = serializeParams(params);
    const second = serializeParams(params);

    expect(second).toBe(first);
    expect(params).toEqual({ filter: { service_id: 1 }, page: 1 });
  });
});
