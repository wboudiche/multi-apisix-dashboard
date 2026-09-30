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
 * The real i18next does the interpolating, including the escaping it applies to
 * an interpolated value, so these are the strings the page renders rather than
 * an approximation of them.
 */
// Read rather than imported: this runs in node, where a JSON import needs an
// attribute the rest of the suite does not use, and the whole run fails to load
// the module without it.
const en = JSON.parse(
  readFileSync(
    new URL('../../../src/locales/en/common.json', import.meta.url),
    'utf8'
  )
) as Record<string, unknown>;

export const i18n = i18next.createInstance();
void i18n.init({
  lng: 'en',
  defaultNS: 'common',
  resources: { en: { common: en } },
});
