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
import { KEY_PREFIXES_BUILT, KEYS_BUILT_FROM_VARIABLES } from './keys-not-readable';
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

const PLURAL_FORM = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL_FORM, '');
const filled = (value: string | undefined) => typeof value === 'string' && value.trim() !== '';

/**
 * Whether a call on `key` resolves from a catalogue: the key as written, or
 * the plural forms written for it. Not the other way round - `t('x_one')`
 * does not resolve from an `x`.
 */
const resolves = (catalogue: Map<string, string>, key: string) =>
  catalogue.has(key) || catalogue.has(`${key}_other`);

const en = flatten(bundle(BASE));
// What `en` writes, each plural family under its base: a translation belongs
// to a family, in whatever forms its own grammar has.
const families = new Set([...en.keys()].map(base));
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
    const stranded = [...translated.keys()].filter((key) => !en.has(key) && !families.has(base(key)));
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
 * A plural form counts by its base, in the forms the language's own grammar
 * has: German needs `x_one` and `x_other`, Chinese `x_other` alone, and a
 * language that writes a key in plural forms must write every form it
 * resolves - a missing `_one` renders English for a count of one, which is the
 * failure this check ends. What English does not distinguish (`many`, in
 * Spanish) is not asked for.
 */
describe.each(LANGUAGES)('%s', (lang) => {
  const translated = translations.get(lang)!;
  const forms = new Intl.PluralRules(lang)
    .resolvedOptions()
    .pluralCategories.filter((form) => ['one', 'other'].includes(form));

  it('has every key en has', () => {
    const missing = [...en.keys()].filter((key) => {
      if (filled(translated.get(key))) return false;
      const pluralised = [...translated.keys()].some((k) => k !== key && base(k) === base(key));
      return !pluralised || !forms.every((form) => filled(translated.get(`${base(key)}_${form}`)));
    });
    expect(missing).toEqual([]);
  });
});

/**
 * What every file spells out is a key `en` holds, every key it reads is
 * spelled out, and every key `en` holds is read by some file. The keys
 * themselves are held above; this holds the source that names them, for every
 * file under src/. Where a key is handed to t() in a variable by design,
 * src/config/keys-not-readable.ts names the file, with the reason, and the
 * prefixes such a file can reach.
 *
 * Read out of the source rather than enumerated: a list of keys goes stale, and
 * the first attempt at this test listed 11 of the 48 these files read.
 */

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

const files = sourceFiles();
const sources = new Map(files.map((file) => [file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')]));

/**
 * The keys a file asks for: every dotted name it spells out under one of
 * `en`'s namespaces.
 *
 * Matching `t('...` instead would read the first argument of a call and stop
 * there, which missed `t(published ? 'info.publish.success' : 'info.unpublish.success')`
 * on the routes list - two keys, in no language but English, on a screen the
 * list of that time called translated.
 *
 * Nothing under a namespace is dropped for not being a key: `reads only keys
 * en holds` below is the check that a name here is one, and filtering on the
 * catalogue first made it vacuous - a key mistyped inside a ternary is
 * invisible to eslint's i18n/no-unknown-key, which does not descend into one,
 * so this is the only thing that would say so. The namespace is what tells a
 * key from a field path (`tls.verify`, `checks.active.timeout`) or a protocol
 * name (`TLSv1.2`): a typo in a key's first segment is the one shape this
 * cannot see, and a literal key that eslint sees anyway.
 */
const namespaces = new Set([...en.keys()].map((key) => key.split('.')[0]));
// Single quotes in code, double in a JSX attribute (`<Trans i18nKey="…">`). A
// name with no dot - `or`, `noData` - is a key only when `en` spells it so.
const keysRead = (source: string) =>
  [...source.matchAll(/(['"])([a-zA-Z][\w-]*(?:\.[\w-]+)*)\1/g)]
    .map((m) => m[2])
    .filter((key) => (key.includes('.') ? namespaces.has(key.split('.')[0]) : en.has(key)));

/**
 * The first argument of each t() call in a source, as text: from the opening
 * parenthesis to the comma or parenthesis that closes it, whatever nests
 * inside.
 */
const firstArguments = (source: string) => {
  const found: string[] = [];
  for (const match of source.matchAll(/\bt\(/g)) {
    let depth = 0;
    let quote: string | undefined;
    for (let at = match.index + match[0].length; at < source.length; at++) {
      const c = source[at];
      if (quote) {
        if (c === '\\') at++;
        else if (c === quote) quote = undefined;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) {
          found.push(source.slice(match.index + match[0].length, at));
          break;
        }
        depth--;
      } else if (c === ',' && depth === 0) {
        found.push(source.slice(match.index + match[0].length, at));
        break;
      }
    }
  }
  return found;
};

/**
 * Whether a key expression can be read: a string literal, or a ternary whose
 * branches can. Anything else - a variable, a field, a lookup, a template -
 * cannot, and the file is held to writing the key out.
 */
const spelled = (expression: string): boolean => {
  const text = expression.trim();
  if (/^'[^']*'$/.test(text)) return true;
  // The first `?` at depth zero that is not `??` or `?.` opens a ternary; its
  // `:` is the one at depth zero after it, skipping the `?`s nested in its
  // branches. Parentheses around the whole of it say nothing: the closing one
  // that brings the depth back to zero is the last character.
  let depth = 0;
  let wrapped = text[0] === '(';
  let quote: string | undefined;
  let question = -1;
  let nested = 0;
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (quote) {
      if (c === '\\') at++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      depth--;
      if (depth === 0 && wrapped) {
        if (at === text.length - 1) return spelled(text.slice(1, -1));
        wrapped = false;
      }
    } else if (depth === 0 && c === '?' && !['?', '.'].includes(text[at + 1]) && text[at - 1] !== '?') {
      if (question === -1) question = at;
      else nested++;
    } else if (depth === 0 && c === ':' && question !== -1) {
      if (nested === 0) return spelled(text.slice(question + 1, at)) && spelled(text.slice(at + 1));
      nested--;
    }
  }
  return false;
};

// `user?.isAdmin ? 'a' : 'b'` was refused as a variable key: the `?` of the
// chain was taken for the ternary's, and the only ways out were to contort the
// condition or to list the file, which lifts the check for all of it.
it.each([
  ["'a.b'", true],
  ["cond ? 'a.b' : 'c.d'", true],
  ["user?.isAdmin ? 'a.b' : 'c.d'", true],
  ["a?.b?.c ? 'a.b' : 'c.d'", true],
  ["a ? 'a.b' : b?.c ? 'c.d' : 'e.f'", true],
  ["(cond ? 'a.b' : 'c.d')", true],
  ["a ? (b ? 'a.b' : 'c.d') : 'e.f'", true],
  ["(a) ? 'a.b' : (b)", false],
  ['(pick)(entry)', false],
  ["cond ? entry?.label : 'c.d'", false],
  ["table[x] ?? 'a.b'", false],
  ['entry?.label', false],
])('reads %s as spelled: %s', (expression, expected) => {
  expect(spelled(expression)).toBe(expected);
});

// `en` writes no key in plural forms today, so nothing in the bundles would
// say if this went back to stripping the suffix off the key the source spells.
it('resolves a key from its plural forms, and not a plural form from its key', () => {
  const plural = new Map([['x_one', ''], ['x_other', '']]);
  expect(resolves(plural, 'x')).toBe(true);
  expect(resolves(new Map([['x', '']]), 'x')).toBe(true);
  expect(resolves(new Map([['x', '']]), 'x_one')).toBe(false);
  expect(resolves(plural, 'y')).toBe(false);
});

it('excludes only files that exist', () => {
  expect(KEYS_BUILT_FROM_VARIABLES.filter((file) => !files.includes(file))).toEqual([]);
});

describe.each(files)('%s', (file) => {
  const source = sources.get(file)!;

  it('reads only keys en holds', () => {
    // A screen asking for a key no bundle has renders the key itself. A key
    // `en` writes in plural forms is asked for by its base, and resolves: the
    // other way round - `t('x_one')` where `en` holds `x` - does not.
    const keys = [...new Set(keysRead(source))].sort();
    expect(keys.filter((key) => !resolves(en, key))).toEqual([]);
  });

  // What the harvest above cannot see: a key held in a variable or built from
  // one. The check above would pass on the keys it does see and say nothing
  // about that one, so the file is held to writing them out - unless that is
  // its design, and the list says so.
  if (!KEYS_BUILT_FROM_VARIABLES.includes(file)) {
    it('spells out every key it reads', () => {
      expect(firstArguments(source).filter((argument) => !spelled(argument))).toEqual([]);
    });
  }
});

/**
 * The other direction: a key `en` holds that no file spells, and no prefix a
 * variable-key file reaches covers, is dead - and costs four translations
 * every time one is added. Eighteen sat in `en` when this was written (#362).
 */
it('holds no key en has that nothing reads', () => {
  const read = new Set([...sources.values()].flatMap(keysRead));
  const dead = [...en.keys()].filter(
    (key) =>
      !read.has(key) && !read.has(base(key)) && !KEY_PREFIXES_BUILT.some((prefix) => key.startsWith(prefix))
  );
  expect(dead).toEqual([]);
});
