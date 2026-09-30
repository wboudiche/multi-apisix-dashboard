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
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { defaultNS, resources } from './i18n';
import { KEYS_NOT_READABLE } from './keys-not-readable';
import { placeholdersIn } from './placeholders';
import { roleLabelKeys } from './role-labels';

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

const placeholders = (value: string) => placeholdersIn(value).sort();

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
  // their arguments. eslint's local/interpolation-data holds the call sites to
  // en's placeholders and reads no other language, so a translation that
  // dropped {{role}} lints clean and renders a blank role.
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
 * Every key `en` has, in every language.
 *
 * i18next answers a missing key with the English text and says nothing, which
 * is how 272 keys came to be English in every language with nothing reporting
 * it (#362). One check over the bundles holds all of them; no file needs to be
 * named for its keys to count.
 *
 * A plural form counts by its base: `en` has `x_one` and `x_other`, and a
 * language has whichever forms its grammar needs, so what it must hold is some
 * form of `x`, not English's.
 */
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');

describe.each(LANGUAGES)('%s', (lang) => {
  const translated = translations.get(lang)!;
  const bases = new Set([...translated.keys()].map(base));

  it('has every key en has', () => {
    const missing = [...en.keys()].filter((key) => {
      const value = translated.get(key);
      if (typeof value === 'string' && value.trim() !== '') return false;
      return key === base(key) || !bases.has(base(key));
    });
    expect(missing).toEqual([]);
  });
});

/**
 * What every file spells out is a key `en` holds, and every key it reads is
 * spelled out. The keys themselves are held above; this holds the source that
 * names them, for every file under src/ but the ones
 * src/config/keys-not-readable.ts names, with the reason.
 *
 * Read out of the source rather than enumerated: a list of keys goes stale, and
 * the first attempt at this test listed 11 of the 48 these files read.
 */

const sourceOf = (file: string) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

/**
 * Every source file, as a path from the repository root - the form the
 * exclusion list spells - but the tests, the bundles and the generated route
 * tree.
 */
const sourceFiles = (dir = 'src'): string[] =>
  readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'locales' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.gen.ts')
      ? [path]
      : [];
  });

/**
 * The keys a file asks for: every dotted name it spells out.
 *
 * Matching `t('...` instead would read the first argument of a call and stop
 * there, which missed `t(published ? 'info.publish.success' : 'info.unpublish.success')`
 * on the routes list - two keys, in no language but English, on a screen the
 * list of that time called translated.
 *
 * Nothing is dropped for not being a key: `reads only keys en holds` below is
 * the check that a name here is one, and filtering first made it vacuous - a
 * key mistyped inside a ternary is invisible to eslint's i18n/no-unknown-key,
 * which does not descend into one, so this is the only thing that would say so.
 * A dotted string that is not a key - a field path, a protocol name - puts its
 * file on the exclusion list, with that reason.
 */
const keysRead = (file: string) =>
  [...sourceOf(file).matchAll(/'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g)].map((m) => m[1]);

const held = sourceFiles().filter((file) => !KEYS_NOT_READABLE.includes(file));

it('excludes only files that exist', () => {
  expect(KEYS_NOT_READABLE.filter((file) => !sourceFiles().includes(file))).toEqual([]);
});

describe.each(held)('%s', (file) => {
  it('spells out every key it reads', () => {
    // What the harvest above cannot see: a key held in a variable or built from
    // one. The check below would pass on the keys it does see and say nothing
    // about that one, so the file is held to writing them out.
    const built = sourceOf(file).match(/\bt\(\s*(?:[A-Za-z_$][\w$]*\s*[,)]|`)/g) ?? [];
    expect(built).toEqual([]);
  });

  it('reads only keys en holds', () => {
    // A screen asking for a key no bundle has renders the key itself.
    const keys = [...new Set(keysRead(file))].sort();
    expect(keys.filter((key) => !en.has(key))).toEqual([]);
  });
});
