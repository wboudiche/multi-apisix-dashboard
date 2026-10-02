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
import i18n from '@/config/i18n';

/** Where the keys of form errors live: what tells a key from a sentence. */
const KEYS = 'form.validation.';

/**
 * A form error as the reader's language has it.
 *
 * A validation message is a plain string to zod, written where there is no
 * `t`: "Name is required" was English in every language, and nothing that
 * holds the screens to their translations looks outside JSX (#364). So a
 * schema writes the key - `form.validation.nameRequired` - and the field shows
 * what the key says.
 *
 * Whatever is not under `form.validation.` is shown as it is: zod's own
 * messages, a gateway's - even one that happens to spell some other key of
 * the bundles. A key no bundle holds is refused before it gets here, by
 * locale-keys.test.ts, which reads the schemas like any other source.
 */
export const errorText = (message: string | undefined) =>
  message?.startsWith(KEYS) && i18n.exists(message) ? i18n.t(message as never) : message;
