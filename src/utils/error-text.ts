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

/** Between a key and its values: no key holds it. */
const VALUES = '?';

/**
 * A message that is a key and the values its text interpolates.
 *
 * A validation message is one string all the way to the field: zod's issue,
 * react-hook-form's error. A minimum length or a prefix travels in it, after
 * the key, and errorText puts it in the text.
 */
export const withValues = (key: string, values: Record<string, string | number>) =>
  `${key}${VALUES}${JSON.stringify(values)}`;

/** The key of a message and its values, or nothing if what follows the key is not values. */
const keyAndValues = (message: string): [string, Record<string, unknown>] | undefined => {
  const at = message.indexOf(VALUES);
  if (at < 0) return [message, {}];
  try {
    const values: unknown = JSON.parse(message.slice(at + 1));
    return values && typeof values === 'object' && !Array.isArray(values)
      ? [message.slice(0, at), values as Record<string, unknown>]
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A form error as the reader's language has it.
 *
 * A validation message is a plain string to zod, written where there is no
 * `t`: "Name is required" was English in every language, and nothing that
 * holds the screens to their translations looks outside JSX (#364). So a
 * schema writes the key - `form.validation.nameRequired` - and the field shows
 * what the key says; zod's own messages are keys too, with their values
 * (src/config/zod-errors.ts).
 *
 * Whatever is not under `form.validation.` is shown as it is: a gateway's
 * message - even one that happens to spell some other key of the bundles. A
 * key no bundle holds is refused before it gets here, by locale-keys.test.ts,
 * which reads the schemas like any other source.
 */
export const errorText = (message: string | undefined) => {
  if (!message?.startsWith(KEYS)) return message;
  const read = keyAndValues(message);
  if (!read) return message;
  const [key, values] = read;
  // eslint-disable-next-line local/readable-key -- spelled by the schema or the error map that wrote the message
  return i18n.exists(key, values) ? i18n.t(key as never, values) : message;
};
