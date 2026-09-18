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

import { certExpiry } from './cert-expiry';

const now = new Date('2026-09-18T12:00:00Z');

describe('what a certificate’s expiry means today', () => {
  it('counts whole days, and says which side of the line they fall', () => {
    expect(certExpiry('2026-12-18T12:00:00Z', now)).toEqual({ days: 91, state: 'ok' });
    expect(certExpiry('2026-10-10T12:00:00Z', now)).toEqual({ days: 22, state: 'soon' });
    expect(certExpiry('2026-09-11T12:00:00Z', now)).toEqual({ days: -7, state: 'expired' });
  });

  it('treats the thirtieth day as still worth warning about', () => {
    // The boundary is the whole point of the banner: a certificate that goes
    // in thirty days has to appear in it, not on the thirty-first refresh.
    expect(certExpiry('2026-10-18T12:00:00Z', now)?.state).toBe('soon');
    expect(certExpiry('2026-10-19T12:00:00Z', now)?.state).toBe('ok');
  });

  it('says nothing about a row it cannot read a date from', () => {
    // The proxy leaves the field off a row whose certificate it could not
    // parse. Inventing a date for it would be worse than an empty cell.
    for (const value of [undefined, null, '', 'not a date', 42, {}]) {
      expect(certExpiry(value, now)).toBeUndefined();
    }
  });
});
