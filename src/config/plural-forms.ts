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
 * The plural forms of a key, described once.
 *
 * eslint's local/interpolation-data resolves a call to the forms i18next may
 * pick, and locale-keys.test.ts holds every language to the forms of `en`'s
 * keys. Each had its own description of a plural suffix, and the test's did
 * not know an ordinal: `place_ordinal_one` was a key of its own to it (#365).
 */
export const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A plural suffix, cardinal or ordinal, at the end of a key. */
export const PLURAL_SUFFIX = new RegExp(`_(?:ordinal_)?(?:${PLURAL_FORMS.join('|')})$`);
