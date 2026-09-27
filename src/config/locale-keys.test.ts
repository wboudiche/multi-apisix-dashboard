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

import { resources } from './i18n';

/**
 * The keys the header and the Users page read, in every language.
 *
 * Twice a translation has sat on a key nothing resolves: `users.th*` after the
 * columns were renamed to `users.column*` (#300), and `header.role` after the
 * account dropdown moved to `header.accountRole` (#319). Both times four
 * languages out of five read English while the words were right there in the
 * file, and nothing failed - i18next falls back to `en` without complaining.
 */
const LANGUAGES = Object.keys(resources) as (keyof typeof resources)[];

const READ_BY_THE_APP = [
  'header.accountRole',
  'roles.superAdmin',
  'roles.instanceAdmin',
  'roles.developer',
  'roles.viewer',
  'roles.user',
  'users.columnUser',
  'users.columnRole',
  'users.columnInstances',
  'users.columnTeams',
  'users.columnCreated',
];

/** Keys that were renamed: a translation put back on one would be unreachable. */
const RETIRED = [
  'header.role',
  'users.thUser',
  'users.thRole',
  'users.thInstances',
  'users.thTeams',
  'users.thCreated',
  'users.thActions',
];

const resolve = (lang: keyof typeof resources, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      resources[lang].common
    );

describe.each(LANGUAGES)('%s', (lang) => {
  it.each(READ_BY_THE_APP)('translates %s', (key) => {
    expect(resolve(lang, key)).toEqual(expect.any(String));
  });

  it.each(RETIRED)('has nothing left on %s', (key) => {
    expect(resolve(lang, key)).toBeUndefined();
  });
});
