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

import type { TFunction } from 'i18next';

import { roleLabel } from '@/config/role-labels';

// Read rather than imported: this runs in node, where a JSON import needs an
// attribute the rest of the suite does not use.
const en = JSON.parse(
  readFileSync(
    new URL('../../../src/locales/en/common.json', import.meta.url),
    'utf8'
  )
) as Record<string, unknown>;

/**
 * The words the dashboard shows for a role, and the account dropdown's line
 * about it.
 *
 * Read from the app's own catalogue and its English bundle rather than written
 * out here: the header used to render the stored value, so specs asserted
 * `viewer` against it with `exact: true`, and naming the role broke nine of
 * them at once (#319). Derived, they follow a change of wording instead of
 * pinning the old one.
 */
const fromEn = ((key: string) =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      en
    )) as unknown as TFunction;

/** What the header shows under the username for `role`. */
export const roleText = (role: string) => roleLabel(fromEn, role);

/** What the account dropdown shows for `role`. */
export const accountRoleText = (role: string) =>
  String(fromEn('header.accountRole')).replace('{{role}}', roleText(role));
