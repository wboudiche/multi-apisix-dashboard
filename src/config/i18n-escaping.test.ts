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

import en_common from '@/locales/en/common.json';

import i18n from './i18n';

/**
 * What a translation does to the value it is given.
 *
 * i18next escapes interpolations for markup by default, and React escapes what
 * it renders anyway, so the two together spelled out &#x2F; on screen: a branch
 * name (#237), a request path (#320), a gateway's admin URL (#338). Each was
 * fixed where it was found, by passing `escapeValue: false` at that call - five
 * copies of the same line, and nothing to stop the sixth (#341).
 *
 * It is set once now, in i18n.ts. This is what says so.
 */
describe('interpolation', () => {
  // Every character i18next's escape map holds - & < > " ' / - across the
  // shapes that reach these keys. The sharp half is the point: a gateway's
  // reason is whatever the gateway said.
  const cases: Array<[string, string]> = [
    ['a URL', 'http://127.0.0.1:9180/apisix/admin'],
    ['a request path', '/api/v1/instances'],
    ['a branch name', 'fix/237-escaping'],
    ['an ampersand', 'A&B'],
    ['a quoted reason', 'Get "http://gw:9180": connection refused'],
    ['an apostrophe', "the gateway's own words"],
    ['angle brackets', '<img src=x onerror=1>'],
  ];

  // Against the bundle's own wording rather than a copy of it here: rewording
  // a key in en/common.json is not a thing that should break this file (the
  // convention role-labels.test.ts states for the same reason).
  const disconnected = (value: string) =>
    en_common.header.healthDisconnectedWhy.replace('{{reason}}', value);

  it.each(cases)('leaves %s as it was given', (_what, value) => {
    const rendered = i18n.t('header.healthDisconnectedWhy', { reason: value });
    expect(rendered).toBe(disconnected(value));
  });

  it.each(cases)('spells out no entity for %s', (_what, value) => {
    // The assertion above pins the whole string, and would catch any of these.
    // Named separately so that a looser expectation later - toContain, say -
    // does not quietly stop guarding the thing this file is about.
    const rendered = i18n.t('header.healthDisconnectedWhy', { reason: value });
    expect(rendered).not.toMatch(/&(amp|lt|gt|quot|#x2F|#39|#\d+);/);
  });

  it('holds for a key that interpolates more than one value', () => {
    const rendered = i18n.t('header.build', {
      sha: 'abc1234',
      branch: 'fix/237-escaping',
      date: '2026-09-29',
    });
    expect(rendered).toContain('fix/237-escaping');
    expect(rendered).not.toMatch(/&(amp|lt|gt|quot|#x2F|#39|#\d+);/);
  });
});
