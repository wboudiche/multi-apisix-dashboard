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

import { globalRoleLabel, type KnownRole, roleLabel } from '@/config/role-labels';

/**
 * The words the dashboard shows for a role, and the account dropdown's line
 * about it.
 *
 * Read from the app's own catalogue and its English bundle rather than written
 * out here: the header used to render the stored value, so specs asserted
 * `viewer` against it with `exact: true`, and naming the role broke nine of
 * them at once (#319). Derived, they follow a change of wording instead of
 * pinning the old one - and `KnownRole` makes a role this build does not know a
 * compile error, rather than a locator the page can never match (#324).
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

const i18n = i18next.createInstance();
void i18n.init({
  lng: 'en',
  defaultNS: 'common',
  resources: { en: { common: en } },
});

/** What the header shows under the username for `role`. */
export const roleText = (role: KnownRole) => roleLabel(i18n.t, role);

/** What the Users page shows for an account that holds no global role. */
export const globalRoleText = () => globalRoleLabel(i18n.t, '');

/** What the account dropdown shows for `role`. */
export const accountRoleText = (role: KnownRole) =>
  i18n.t('header.accountRole', { role: roleText(role) });
