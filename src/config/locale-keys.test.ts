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
import { roleLabelKeys } from './role-labels';
import { FULLY_TRANSLATED_SCREENS } from './translated-screens';

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
  // A leaf that is not a string is still a key somebody wrote: counted, so the
  // stranded-key check below sees a translator's stray `"count": 0` too.
  if (node === null || typeof node !== 'object') {
    out.set(prefix, String(node));
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
  [...value.matchAll(/\{\{-?\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]).sort();

const en = flatten(bundle(BASE));
const translations = new Map(LANGUAGES.map((lang) => [lang, flatten(bundle(lang))]));

describe.each(LANGUAGES)('%s', (lang) => {
  const translated = translations.get(lang)!;

  // The retired-key check. A translation on a key `en` does not have is a
  // translation nothing can resolve - which is what a rename leaves behind.
  //
  // A plural form is not that: i18next resolves `x_one` and `x_other` from a
  // call on `x`, and a language needs the forms its own grammar has rather than
  // the ones English happens to need. Spanish says "1 seleccionado" where
  // English says "1 selected" for any count.
  it('holds no key en does not have', () => {
    const base = (key: string) =>
      key.replace(/_(zero|one|two|few|many|other)$/, '');
    const stranded = [...translated.keys()].filter(
      (key) => !en.has(key) && !en.has(base(key))
    );
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
 * The spellings three renames left behind. The shape checks above are what
 * catches a rename in general; this list is the anchor under them, because a
 * retired key that came back into `en` - a bad merge, a partial revert - would
 * make the translations of it legitimate again and silence the check that
 * replaced this list (#324).
 */
const RETIRED = [
  'header.role',
  'users.thUser',
  'users.thRole',
  'users.thInstances',
  'users.thTeams',
  'users.thCreated',
  'users.thActions',
  'users.accessDenied',
  'users.accessDeniedMessage',
  'users.assignHint',
  'users.noUsers',
  'users.noUsersHint',
];

describe.each([BASE, ...LANGUAGES])('%s', (lang) => {
  const flat = lang === BASE ? en : translations.get(lang)!;

  it.each(RETIRED)('has nothing left on %s', (key) => {
    expect(flat.get(key)).toBeUndefined();
  });
});

/**
 * The keys the role catalogue asks i18next for. No screen spells them out -
 * they go through `roleLabel(t, role)` - so neither eslint nor the source read
 * below can see them, and dropping `roles.viewer` from a locale passed every
 * test until this was added.
 */
describe.each(LANGUAGES)('%s', (lang) => {
  const translated = translations.get(lang)!;

  it.each(roleLabelKeys)('translates %s', (key) => {
    const value = translated.get(key);
    expect(typeof value === 'string' && value.trim() !== '').toBe(true);
  });
});

/**
 * The screens whose every key must exist in every language, and the list the
 * eslint guard reads beside it: see src/config/translated-screens.ts, where the
 * two halves of a finished screen are kept together.
 *
 * Read out of the source rather than enumerated: a list of keys goes stale, and
 * the first attempt at this test listed 11 of the 48 these files read.
 */

const sourceOf = (file: string) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

/**
 * The keys a file asks for: every dotted name it spells out, kept if `en` holds
 * one by that name.
 *
 * Matching `t('...` instead would read the first argument of a call and stop
 * there, which missed `t(published ? 'info.publish.success' : 'info.unpublish.success')`
 * on the routes list - two keys, in no language but English, on a screen the
 * list below called translated.
 *
 * A dotted string that names nothing is dropped rather than reported: eslint's
 * i18n/no-unknown-key already fails on a key `en` lacks, at the call site.
 */
const keysRead = (file: string) =>
  [...sourceOf(file).matchAll(/'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g)]
    .map((m) => m[1])
    .filter((key) => en.has(key));

describe.each(FULLY_TRANSLATED_SCREENS)('%s', (file) => {
  const keys = [...new Set(keysRead(file))].sort();

  it('spells out every key it reads', () => {
    // What the harvest above cannot see: a key held in a variable or built from
    // one. The check below would pass on the keys it does see and say nothing
    // about that one, so the file is held to writing them out.
    const built = sourceOf(file).match(/\bt\(\s*(?:[A-Za-z_$][\w$]*\s*[,)]|`)/g) ?? [];
    expect(built).toEqual([]);
  });

  it('reads only keys en holds', () => {
    // A screen asking for a key no bundle has renders the key itself. Reported
    // here rather than dropped from the list below.
    expect(keys.filter((key) => !en.has(key))).toEqual([]);
  });

  it.each(LANGUAGES)('is translated into %s', (lang) => {
    const translated = translations.get(lang)!;
    const missing = keys.filter((key) => {
      const value = translated.get(key);
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(missing).toEqual([]);
  });
});
