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

import { isResourceEnabled } from './status';

describe('isResourceEnabled', () => {
  it('treats an explicit 1 as live', () => {
    expect(isResourceEnabled(1)).toBe(true);
  });

  it('treats an explicit 0 as disabled — the only thing that disables', () => {
    expect(isResourceEnabled(0)).toBe(false);
  });

  it('treats an absent status as live', () => {
    // APISIX omits the field when it was never set, and such a route matches
    // traffic exactly as one with status: 1 does. This is the case the old
    // `status === 1` comparison got wrong.
    expect(isResourceEnabled(undefined)).toBe(true);
  });

  it('treats a null status as live', () => {
    expect(isResourceEnabled(null)).toBe(true);
  });

  it('agrees with the backend list filter', () => {
    // matchesStatus in api/internal/handlers/list_filter.go answers `want == 1`
    // for an absent status. The two have to say the same thing, or filtering by
    // Published returns rows the table then labels Unpublished.
    const backendSaysPublished = (status?: number | null) =>
      status === undefined || status === null ? true : status === 1;

    for (const status of [undefined, null, 0, 1] as const) {
      expect(isResourceEnabled(status)).toBe(backendSaysPublished(status));
    }
  });
});
