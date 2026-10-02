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

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { defaultNS, resources } from './i18n';
import { placeholdersIn } from './placeholders';
import { PLURAL_SUFFIX } from './plural-forms';
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

const base = (key: string) => key.replace(PLURAL_SUFFIX, '');
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
 * What every file spells out is a key `en` holds, and every key `en` holds is
 * read by some file. The keys themselves are held above; this holds the
 * source that names them, for every file under src/.
 *
 * That a key is spelled where it is asked for - not handed to t() in a
 * variable, where nothing here could read it - is eslint's
 * local/readable-key. It was this test's, by scanning the source as text, and
 * each review found ordinary code the scan misread (#365).
 *
 * Read out of the source rather than enumerated: a list of keys goes stale, and
 * the first attempt at this test listed 11 of the 48 these files read.
 */

/**
 * Every source file, as a path from the repository root, but the tests, the
 * bundles and the generated route tree.
 */
const sourceFiles = (dir = 'src'): string[] =>
  readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'locales' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.gen.ts')
      ? [path]
      : [];
  });

const namespaces = new Set([...en.keys()].map((key) => key.split('.')[0]));

/** `t(…)` and `i18n.t(…)`. */
const isTranslate = (callee: ts.Expression) =>
  (ts.isIdentifier(callee) && callee.text === 't') ||
  (ts.isPropertyAccessExpression(callee) && callee.name.text === 't');

/**
 * What a source reads of the bundles, out of its syntax tree.
 *
 * `keys`: every string it spells that is a dotted name under one of `en`'s
 * namespaces, wherever it stands - an argument of t(), a branch of a ternary,
 * a row of a table the key is looked up in, a JSX attribute. Nothing under a
 * namespace is dropped for not being a key: `reads only keys en holds` below
 * is the check that a name here is one, and filtering on the catalogue first
 * made it vacuous - a key mistyped inside a ternary is invisible to eslint's
 * i18n/no-unknown-key, which does not descend into one, so this is the only
 * thing that would say so. The namespace is what tells a key from a field
 * path (`tls.verify`, `checks.active.timeout`) or a protocol name
 * (`TLSv1.2`). A name with no dot - `or`, `noData` - is a key only when `en`
 * spells it so.
 *
 * `prefixes`: what a call builds its key from - ``t(`sources.${label}`)``
 * reaches every key under `sources.`, and none of them is dead for being
 * spelled by no file. Read off the call rather than listed beside it: a
 * listed prefix outlived the call that built from it, and sheltered every key
 * under it from the dead-key check for good.
 *
 * A comment is not source: a key quoted in one is not read, and sheltered a
 * dead key when the source was matched as text.
 */
const readOf = (file: string, source: string) => {
  const keys: string[] = [];
  const prefixes: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const { text } = node;
      if (/^[a-zA-Z][\w-]*(?:\.[\w-]+)*$/.test(text)) {
        if (text.includes('.') ? namespaces.has(text.split('.')[0]) : en.has(text)) keys.push(text);
      }
    }
    if (ts.isCallExpression(node) && isTranslate(node.expression)) {
      const [key] = node.arguments;
      if (key && ts.isTemplateExpression(key) && key.head.text !== '') prefixes.push(key.head.text);
    }
    node.forEachChild(visit);
  };
  visit(
    ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      false,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
  );
  return { keys, prefixes };
};

const files = sourceFiles();
const reads = new Map(
  files.map((file) => [
    file,
    readOf(file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')),
  ])
);

describe('what a source reads of the bundles', () => {
  const read = (source: string) => readOf('probe.tsx', source);

  it('is every key it spells, wherever it stands', () => {
    const { keys } = read(`
      const a = t('info.add.success');
      const b = t(published ? 'info.publish.success' : 'info.unpublish.success');
      const table = { viewer: 'roles.viewer' } as const;
      const c = <Trans i18nKey="form.btn.next" />;
      const d = t(\`form.btn.save\`);
    `);

    expect(keys).toEqual([
      'info.add.success',
      'info.publish.success',
      'info.unpublish.success',
      'roles.viewer',
      'form.btn.next',
      'form.btn.save',
    ]);
  });

  it('is not a field path, a protocol, or a word en does not spell as a key', () => {
    expect(read("const a = ['tls.verify', 'TLSv1.2', 'upstream', 'x.y'];").keys).toEqual([]);
    expect(read("const a = ['or', 'noData'];").keys).toEqual(['or', 'noData']);
  });

  it('is not a key quoted in a comment', () => {
    const { keys } = read(`
      // 'info.add.success' was read here once
      /** and \`t('info.delete.success')\` there */
      const a = 1;
    `);

    expect(keys).toEqual([]);
  });

  it('is the prefix a call builds its key from', () => {
    const { keys, prefixes } = read(`
      const a = t(\`sources.\${route.label}\`);
      const b = i18n.t(\`form.plugins.category.\${category}\`, { count });
      const c = other(\`routes.\${x}\`);
      const d = t(\`\${whole}\`);
    `);

    expect(prefixes).toEqual(['sources.', 'form.plugins.category.']);
    expect(keys).toEqual([]);
  });
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

describe.each(files)('%s', (file) => {
  it('reads only keys en holds', () => {
    // A screen asking for a key no bundle has renders the key itself. A key
    // `en` writes in plural forms is asked for by its base, and resolves: the
    // other way round - `t('x_one')` where `en` holds `x` - does not.
    const keys = [...new Set(reads.get(file)!.keys)].sort();
    expect(keys.filter((key) => !resolves(en, key))).toEqual([]);
  });
});

/**
 * The other direction: a key `en` holds that no file spells, and no call
 * builds a key towards, is dead - and costs four translations every time one
 * is added. Eighteen sat in `en` when this was written (#362).
 */
it('holds no key en has that nothing reads', () => {
  const all = [...reads.values()];
  const read = new Set(all.flatMap(({ keys }) => keys));
  const prefixes = [...new Set(all.flatMap(({ prefixes }) => prefixes))];
  const dead = [...en.keys()].filter(
    (key) =>
      !read.has(key) && !read.has(base(key)) && !prefixes.some((prefix) => key.startsWith(prefix))
  );
  expect(dead).toEqual([]);
});

// A prefix nothing under it answers to is a call building keys no bundle
// holds - or one whose keys were all removed and that should go with them.
it('builds no key towards a prefix en holds nothing under', () => {
  const prefixes = [...new Set([...reads.values()].flatMap(({ prefixes }) => prefixes))];
  const empty = prefixes.filter((prefix) => ![...en.keys()].some((key) => key.startsWith(prefix)));
  expect(empty).toEqual([]);
});
