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
 * What a translation interpolates, read the one way.
 *
 * Two checks read placeholders out of a text: eslint's local/interpolation-data
 * holds the call sites to `en`'s, and locale-keys.test.ts holds the other
 * languages to them. Each with a grammar of its own, a `{{date, datetime}}`
 * that one reads and the other does not is a placeholder a translator can drop
 * with nothing to say so.
 */

/** `{{name}}`, `{{- name}}` (unescaped), `{{name, format}}` and `{{user.name}}`. */
const PLACEHOLDER = /\{\{-?\s*([^},\s]+)\s*(?:,[^}]*)?\}\}/g;

/** The placeholders of a text, in order, as written: `user.name` whole. */
export const placeholdersIn = (text: string) =>
  [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
