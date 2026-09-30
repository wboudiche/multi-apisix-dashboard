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
 * The files whose every key must exist in every language.
 *
 * This is the half of #328 that is still a list. The other half - eslint
 * holding JSX attributes to i18n, not only JSX text - began as a list beside
 * this one and now covers every screen (eslint.config.ts), so English cannot
 * creep back into the source anywhere. The other four languages falling behind
 * it is what nothing reports for a file that is not named here.
 *
 * A file joins once the keys it reads are written in all five: naming one
 * before that fails the check in locale-keys.test.ts, by key.
 *
 * It stops at the file boundary: what a screen composes - BuildIdentity,
 * TeamSwitcher, the Users page's modals - is not walked, so a key of theirs can
 * still fall back to English unless the component is named here itself, as the
 * form sections below are. The same goes for a helper a screen calls:
 * `healthReason`'s keys are checked by its own test instead.
 *
 * `routes/add.tsx` and `routes/detail.$id.tsx` are not done - both still read
 * keys no language but English has - and neither is
 * `FormPartUpstream/index.tsx`, which also spells its field names
 * (`tls.verify`) the way the check reads a key.
 */
export const FULLY_TRANSLATED_SCREENS = [
  'src/routes/users/index.tsx',
  'src/components/Header/index.tsx',
  'src/routes/instances/index.tsx',
  'src/routes/settings/index.tsx',
  'src/routes/routes/index.tsx',
  'src/components/form-slice/FormPartRoute/index.tsx',
  'src/components/form-slice/FormPartRoute/FormSectionRequestOverride.tsx',
  'src/components/form-slice/FormPartSSL/index.tsx',
  'src/components/form-slice/FormPartUpstream/FormItemNodes.tsx',
];
