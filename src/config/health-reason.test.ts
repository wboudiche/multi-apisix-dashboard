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
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { healthReason } from './health-reason';
import { i18nOptions } from './i18n';

const i18n = i18next.createInstance();
void i18n.init(i18nOptions);

const CODES = ['unreachable', 'not_read', 'unreadable'] as const;

describe('healthReason', () => {
  // In every language rather than English alone: a key missing from one falls
  // back to English, which is the sentence #340 was about. With no fallback,
  // a missing key comes back as the key itself and fails the comparison.
  describe.each(['en', 'de', 'es', 'tr', 'zh'])('in %s', (lng) => {
    const t = i18n.getFixedT(lng);
    const strict = i18next.createInstance();
    void strict.init({ ...i18nOptions, lng, fallbackLng: false });

    it.each(CODES)('words %s from its own bundle', (code) => {
      const reason = healthReason(t, { code });
      expect(reason).toBeTruthy();
      expect(reason).not.toContain('healthReason');
      expect(healthReason(strict.t, { code })).toBe(reason);
    });

    it('says each code differently', () => {
      const reasons = CODES.map((code) => healthReason(t, { code }));
      expect(new Set(reasons).size).toBe(CODES.length);
    });
  });

  it('prefers the probe error a super_admin is sent', () => {
    // The raw error names what to fix; the code only says that something is
    // wrong.
    const error = 'Get "http://10.0.3.14:9180/apisix/admin/services": i/o timeout';
    expect(healthReason(i18n.t, { code: 'unreachable', error })).toBe(error);
  });

  it.each([
    ['no health at all', undefined],
    ['no code', {}],
    ['a code this build does not know', { code: 'on_fire' }],
  ])('gives no reason for %s', (_what, health) => {
    expect(healthReason(i18n.t, health)).toBeUndefined();
  });
});
