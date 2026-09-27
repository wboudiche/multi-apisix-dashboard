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

import { describe, expect, it } from 'vitest';

import { defaultNS, resources } from './i18n';

/**
 * What a rename leaves behind, and what a screen needs in every language.
 *
 * i18next answers a missing key with the English one and says nothing, so a
 * renamed key strands its translations silently. It has happened three times:
 * `users.th*` when the columns were renamed (#300), `header.role` when the
 * account dropdown moved to `header.accountRole` (#319), and five more on the
 * Users page that the hand-written lists of the first attempt missed (#324).
 *
 * Neither check below holds a list of keys. A list has to be extended by hand
 * on every rename, which is the thing that keeps being forgotten.
 */

type Lang = keyof typeof resources;

const BASE: Lang = 'en';
const LANGUAGES = (Object.keys(resources) as Lang[]).filter((l) => l !== BASE);

const bundle = (lang: Lang) => resources[lang][defaultNS] as Record<string, unknown>;

/** Every leaf, as the dotted key i18next resolves. */
const flatten = (node: unknown, prefix = ''): Map<string, string> => {
  const out = new Map<string, string>();
  if (typeof node === 'string') {
    out.set(prefix, node);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
  }
  return out;
};

const placeholders = (value: string) =>
  [...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]).sort();

const en = flatten(bundle(BASE));

describe.each(LANGUAGES)('%s', (lang) => {
  const translated = flatten(bundle(lang));

  // The retired-key check. A translation on a key `en` does not have is a
  // translation nothing can resolve - which is what a rename leaves behind.
  it('holds no key en does not have', () => {
    const stranded = [...translated.keys()].filter((key) => !en.has(key));
    expect(stranded).toEqual([]);
  });

  // The other half of a rename: the words must still say the same thing about
  // their arguments. eslint's i18n/interpolation-data only lints en, so a
  // translation that dropped {{role}} lints clean and renders a blank role.
  it('keeps the placeholders en uses', () => {
    const changed = [...translated.entries()]
      .filter(([key]) => en.has(key))
      .map(([key, value]) => ({
        key,
        mine: placeholders(value),
        en: placeholders(en.get(key)!),
      }))
      .filter(({ mine, en: base }) => mine.join() !== base.join());
    expect(changed).toEqual([]);
  });
});

/**
 * The screens whose every key must exist in every language. Read out of the
 * source rather than enumerated: a list of keys goes stale, and the first
 * attempt at this test listed 11 of the 48 these two files read.
 *
 * Only the two screens the three renames touched, for now - the rest of the
 * dashboard is translated as far as it is translated, which is what
 * vite-plugin-i18n-progress reports on.
 */
const FULLY_TRANSLATED_SCREENS = [
  'src/routes/users/index.tsx',
  'src/components/Header/index.tsx',
];

/** The keys a file asks for by name. A key built from a variable is invisible
 *  here, which is the price of not keeping a list. */
const keysRead = (file: string) =>
  [...readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    .matchAll(/\bt\('([^']+)'/g)]
    .map((m) => m[1])
    .filter((key) => en.has(key));

describe.each(FULLY_TRANSLATED_SCREENS)('%s', (file) => {
  const keys = [...new Set(keysRead(file))].sort();

  it('reads keys en holds', () => {
    // Guards the regex above: a file whose keys stopped being found would make
    // every language below pass on an empty list.
    expect(keys.length).toBeGreaterThan(10);
  });

  it.each(LANGUAGES)('is translated into %s', (lang) => {
    const translated = flatten(bundle(lang));
    const missing = keys.filter((key) => {
      const value = translated.get(key);
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(missing).toEqual([]);
  });
});
