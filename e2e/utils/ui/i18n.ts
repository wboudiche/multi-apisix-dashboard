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
import { readFileSync } from 'node:fs';

import i18next from 'i18next';

/**
 * An i18next instance over the app's English bundle, so a spec can assert the
 * words the page renders without writing them out: a spec that pins the
 * English text fails the day the wording improves, with a timeout that says
 * nothing about why (#319, #342).
 *
 * The real i18next does the interpolating, with the app's own setting for
 * escaping it, so these are the strings the page renders rather than an
 * approximation of them.
 */
// Read rather than imported: this runs in node, where a JSON import needs an
// attribute the rest of the suite does not use, and the whole run fails to load
// the module without it.
const bundle = (lng: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../src/locales/${lng}/common.json`, import.meta.url), 'utf8')
  ) as Record<string, unknown>;

const instanceFor = (lng: string) => {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    defaultNS: 'common',
    resources: { [lng]: { common: bundle(lng) } },
    // As src/config/i18n.ts has it since #341. Left at i18next's default, an
    // apostrophe in an interpolated value came out as &#39; here and as itself on
    // the page, and the spec comparing the two failed on a page that was right.
    interpolation: { escapeValue: false },
  });
  return instance;
};

export const i18n = instanceFor('en');

/**
 * The same over another language's bundle, for a spec that has to tell a page
 * reading its keys from one with the sentences written in: in English the two
 * read alike. With no fallback to English, so a key the language lacks comes
 * back as the key and fails the assertion.
 */
export const i18nIn = (lng: 'de' | 'es' | 'tr' | 'zh') => instanceFor(lng);
