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

/**
 * The screens #328 has worked through, in the two halves that make one done.
 *
 * They are two lists rather than one because they hold different things: the
 * guard is a directory, since a screen is a route file and whatever it composes
 * beside it, while the check below reads keys out of a single file. They live
 * here together so that a screen cannot join one and be forgotten in the other
 * - half-guarded means either English creeping back into the source, or the
 * other four languages falling behind it, with nothing reporting either.
 */

/** Where eslint holds JSX attributes to i18n, not only JSX text. */
export const ATTRIBUTES_GUARDED = [
  'src/components/Header/**/*.tsx',
  'src/routes/instances/**/*.tsx',
  'src/routes/users/**/*.tsx',
  'src/routes/settings/**/*.tsx',
];

/**
 * The screens whose every key must exist in every language.
 *
 * It stops at the file boundary: what a screen composes - BuildIdentity,
 * TeamSwitcher, the Users page's modals - is not walked, so a key of theirs can
 * still fall back to English. It also cannot see a sentence the Go backend
 * wrote: the settings page shows the server's own reason for refusing a
 * password policy, and that reason is English for everyone (#340).
 */
export const FULLY_TRANSLATED_SCREENS = [
  'src/routes/users/index.tsx',
  'src/components/Header/index.tsx',
  'src/routes/instances/index.tsx',
  'src/routes/settings/index.tsx',
];
