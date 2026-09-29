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

import i18n from './i18n';

/**
 * What a translation does to the value it is given.
 *
 * i18next escapes interpolations for markup by default, and React escapes what
 * it renders anyway, so the two together spelled out &#x2F; on screen: a branch
 * name (#237), a request path (#320), a gateway's admin URL (#338). Each was
 * fixed where it was found, by passing `escapeValue: false` at that call - four
 * copies of the same line, and nothing to stop the fifth (#341).
 *
 * It is set once now, in i18n.ts. This is what says so.
 */
describe('interpolation', () => {
  const cases: Array<[string, string]> = [
    ['a URL', 'http://127.0.0.1:9180/apisix/admin'],
    ['a request path', '/api/v1/instances'],
    ['a branch name', 'fix/237-escaping'],
    ['an ampersand', 'A&B'],
    ['a quoted reason', 'Get "http://gw:9180": connection refused'],
  ];

  it.each(cases)('leaves %s as it was given', (_what, value) => {
    const rendered = i18n.t('header.healthDisconnectedWhy', { reason: value });
    expect(rendered).toBe(`Disconnected: ${value}`);
    expect(rendered).not.toContain('&#x');
    expect(rendered).not.toContain('&amp;');
  });

  it('holds for a key that interpolates more than one value', () => {
    const rendered = i18n.t('header.build', {
      sha: 'abc1234',
      branch: 'fix/237-escaping',
      date: '2026-09-29',
    });
    expect(rendered).toContain('fix/237-escaping');
    expect(rendered).not.toContain('&#x');
  });
});
