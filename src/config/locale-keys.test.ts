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

import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import {
  attributeExpression,
  calledName,
  type Node,
  readingOf,
} from '../../eslint-rules/key-argument';
import { defaultNS, resources } from './i18n';
import { placeholdersIn } from './placeholders';
import { PLURAL_FORMS, PLURAL_SUFFIX } from './plural-forms';
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

/** The key a call asks for: `routes` for `routes_one`, `place` for `place_ordinal_two`. */
const base = (key: string) => key.replace(PLURAL_SUFFIX, '');
/** The family a form belongs to: `routes` for `routes_one`, `place_ordinal` for `place_ordinal_two`. */
const family = (key: string) => key.replace(new RegExp(`_(?:${PLURAL_FORMS.join('|')})$`), '');
const filled = (value: string | undefined) => typeof value === 'string' && value.trim() !== '';

/**
 * Whether a call on `key` resolves from a catalogue: the key as written, or
 * the plural forms written for it. Not the other way round - `t('x_one')`
 * does not resolve from an `x`.
 */
const resolves = (catalogue: { has(key: string): boolean }, key: string) =>
  catalogue.has(key) || catalogue.has(`${key}_other`) || catalogue.has(`${key}_ordinal_other`);

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
 * Spanish) is not asked for. An ordinal family - `place_ordinal_one` - is
 * held to the ordinal forms of the language, not to the cardinal ones.
 */
describe.each(LANGUAGES)('%s', (lang) => {
  const translated = translations.get(lang)!;
  // The forms this language has, among the ones English tells apart.
  const formsOf = (ordinal: boolean) =>
    new Intl.PluralRules(lang, { type: ordinal ? 'ordinal' : 'cardinal' })
      .resolvedOptions()
      .pluralCategories.filter((form) =>
        (ordinal ? ['one', 'two', 'few', 'other'] : ['one', 'other']).includes(form)
      );

  it('has every key en has', () => {
    const missing = [...en.keys()].filter((key) => {
      if (filled(translated.get(key))) return false;
      const of = family(key);
      const pluralised = [...translated.keys()].some((k) => k !== key && family(k) === of);
      return (
        !pluralised ||
        !formsOf(of.endsWith('_ordinal')).every((form) => filled(translated.get(`${of}_${form}`)))
      );
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

/** What the reader needs of a bundle: its keys, and the namespaces they are under. */
type Catalogue = { has(key: string): boolean; namespaces: Set<string> };

const catalogueOf = (keys: Iterable<string>): Catalogue => {
  const all = new Set(keys);
  return { has: (key) => all.has(key), namespaces: new Set([...all].map((key) => key.split('.')[0])) };
};

const KEY_SHAPE = /^[a-zA-Z][\w-]*(?:\.[\w-]+)*$/;

/** The syntax tree eslint's rules are given: the same parser, the same nodes. */
const parse = (file: string, source: string) => {
  const parser = tseslint.parser as unknown as {
    parseForESLint(source: string, options: object): { ast: Node };
  };
  return parser.parseForESLint(source, { ecmaFeatures: { jsx: file.endsWith('x') } }).ast;
};

/** Every node of a tree, the root first. */
const walk = (node: Node, visit: (node: Node) => void) => {
  visit(node);
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof (child as Node).type === 'string') {
        walk(child as Node, visit);
      }
    }
  }
};

/**
 * What a source reads of the bundles, out of its syntax tree.
 *
 * `asked`: the keys it hands to t(), to i18n.t() or to a `<Trans i18nKey>`,
 * read as eslint's rules read a key argument (eslint-rules/key-argument.ts) -
 * through a ternary, through a cast. Each is held to being a key `en` holds,
 * whatever it looks like: `t('fomr.btn.save' as never)` is seen by no lint
 * rule, and was dropped here too for not being under a namespace.
 *
 * `spelled`: every other string that is a dotted name under one of `en`'s
 * namespaces, wherever it stands - a row of a table a key is looked up in, a
 * message a schema writes. Nothing under a namespace is dropped for not
 * being a key: `reads only keys en holds` below is the check that a name
 * here is one. The namespace is what tells a key from a field path
 * (`tls.verify`, `checks.active.timeout`) or a protocol name (`TLSv1.2`); a
 * name with no dot - `or`, `noData` - is a key only when `en` spells it so.
 * A typo in the first segment of a key that is in a table and not in a call
 * is the one shape nothing sees.
 *
 * `templates`: what a call builds its key from, as the texts around its
 * values - ``t(`sources.${label}`)`` is `['sources.', '']`, and reaches every
 * key of that shape. Read off the call rather than listed beside it: a listed
 * prefix outlived the call that built from it, and sheltered every key under
 * it from the dead-key check for good.
 *
 * A comment is not source: a key quoted in one is not read, and sheltered a
 * dead key when the source was matched as text.
 */
const readOf = (file: string, source: string, catalogue: Catalogue) => {
  const asked: string[] = [];
  const spelled: string[] = [];
  const templates: string[][] = [];
  const ask = (argument: Node | undefined) => {
    const reading = readingOf(argument);
    asked.push(...reading.keys);
    templates.push(...reading.templates);
  };
  walk(parse(file, source), (node) => {
    if (node.type === 'CallExpression' && calledName(node.callee as Node) === 't') {
      ask((node.arguments as Node[])[0]);
    }
    if (node.type === 'JSXOpeningElement' && (node.name as Node).name === 'Trans') {
      const key = (node.attributes as Node[]).find(
        (a) => a.type === 'JSXAttribute' && (a.name as Node).name === 'i18nKey'
      );
      if (key) ask(attributeExpression(key));
    }
    const text =
      node.type === 'Literal' && typeof node.value === 'string'
        ? node.value
        : node.type === 'TemplateElement'
          ? (node.value as { cooked: string }).cooked
          : undefined;
    if (text !== undefined && KEY_SHAPE.test(text)) {
      if (text.includes('.') ? catalogue.namespaces.has(text.split('.')[0]) : catalogue.has(text)) {
        spelled.push(text);
      }
    }
  });
  return { asked, spelled, templates };
};

/**
 * The keys a template reaches: the texts around its values, with anything
 * between them. ``t(`form.${section}.title`)`` reaches `form.x.title` and
 * not the rest of `form.`.
 */
const reach = (texts: string[]) =>
  new RegExp(`^${texts.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);

describe('what a source reads of the bundles', () => {
  const fixture = catalogueOf(['info.add.success', 'roles.viewer', 'form.btn.next', 'or', 'noData']);
  const read = (source: string) => readOf('probe.tsx', source, fixture);

  it('is every key it hands to a translation, whatever the key looks like', () => {
    const { asked } = read(`
      const a = t('info.add.success');
      const b = t(published ? 'info.publish.success' : 'info.unpublish.success');
      const c = <Trans i18nKey="form.btn.next" />;
      const d = i18n.t(\`form.btn.save\`);
      const e = t('fomr.btn.save' as never);
      const f = t(ok ? 'noDatta' : 'noData');
      const g = <Trans i18nKey={ok ? 'a.b' : 'c.d'} />;
    `);

    expect(asked).toEqual([
      'info.add.success',
      'info.publish.success',
      'info.unpublish.success',
      'form.btn.next',
      'form.btn.save',
      'fomr.btn.save',
      'noDatta',
      'noData',
      'a.b',
      'c.d',
    ]);
  });

  it('is every key it spells elsewhere, under a namespace of the bundle', () => {
    const { spelled, asked } = read(`
      const table = { viewer: 'roles.viewer', unknown: 'roles.nobody' } as const;
      const schema = z.string().min(1, 'form.validation.nameRequired');
    `);

    expect(spelled).toEqual(['roles.viewer', 'roles.nobody', 'form.validation.nameRequired']);
    expect(asked).toEqual([]);
  });

  it('is not a field path, a protocol, or a word the bundle does not spell as a key', () => {
    expect(read("const a = ['tls.verify', 'TLSv1.2', 'upstream', 'x.y'];").spelled).toEqual([]);
    expect(read("const a = ['or', 'noData'];").spelled).toEqual(['or', 'noData']);
  });

  it('is not a key quoted in a comment', () => {
    const { asked, spelled } = read(`
      // 'info.add.success' was read here once
      /** and \`t('info.delete.success')\` there */
      const a = 1;
    `);

    expect([...asked, ...spelled]).toEqual([]);
  });

  it('is what a call builds its key from, read as the lint rules read the call', () => {
    const { templates } = read(`
      const a = t(\`sources.\${route.label}\`);
      const b = i18n.t(\`form.plugins.category.\${category}\` as never, { count });
      const c = t(cond ? \`form.\${section}.title\` : 'form.btn.next');
      const d = <Trans i18nKey={\`roles.\${role}\`} />;
      const e = other(\`routes.\${x}\`);
    `);

    expect(templates).toEqual([
      ['sources.', ''],
      ['form.plugins.category.', ''],
      ['form.', '.title'],
      ['roles.', ''],
    ]);
  });

  it('reaches the keys of a template’s shape, and no others under its prefix', () => {
    expect(reach(['sources.', '']).test('sources.routes')).toBe(true);
    expect(reach(['sources.', '']).test('sources.')).toBe(false);
    expect(reach(['form.', '.title']).test('form.basic.title')).toBe(true);
    expect(reach(['form.', '.title']).test('form.basic.name')).toBe(false);
    expect(reach(['a.b.', '']).test('axb.c')).toBe(false);
  });
});

const catalogue = catalogueOf(en.keys());
const files = sourceFiles();
const reads = new Map(
  files.map((file) => [
    file,
    readOf(file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), catalogue),
  ])
);
const templates = [...reads.values()].flatMap((read) => read.templates);

// `en` writes no key in plural forms today, so nothing in the bundles would
// say if this went back to stripping the suffix off the key the source spells.
it('resolves a key from its plural forms, and not a plural form from its key', () => {
  const plural = new Map([['x_one', ''], ['x_other', '']]);
  expect(resolves(plural, 'x')).toBe(true);
  expect(resolves(new Map([['x', '']]), 'x')).toBe(true);
  expect(resolves(new Map([['x', '']]), 'x_one')).toBe(false);
  expect(resolves(plural, 'y')).toBe(false);
  // An ordinal family answers the key it is asked for by, and is one family.
  const ordinal = new Map([['place_ordinal_one', ''], ['place_ordinal_other', '']]);
  expect(resolves(ordinal, 'place')).toBe(true);
  expect(base('place_ordinal_two')).toBe('place');
  expect(family('place_ordinal_two')).toBe('place_ordinal');
  expect(family('routes_one')).toBe('routes');
});

describe.each(files)('%s', (file) => {
  it('reads only keys en holds', () => {
    // A screen asking for a key no bundle has renders the key itself. A key
    // `en` writes in plural forms is asked for by its base, and resolves: the
    // other way round - `t('x_one')` where `en` holds `x` - does not.
    const { asked, spelled } = reads.get(file)!;
    const keys = [...new Set([...asked, ...spelled])].sort();
    expect(keys.filter((key) => !resolves(en, key))).toEqual([]);
  });
});

/**
 * The other direction: a key `en` holds that no file spells, and no call
 * builds a key towards, is dead - and costs four translations every time one
 * is added. Eighteen sat in `en` when this was written (#362).
 */
it('holds no key en has that nothing reads', () => {
  const read = new Set([...reads.values()].flatMap(({ asked, spelled }) => [...asked, ...spelled]));
  const reached = templates.map(reach);
  const dead = [...en.keys()].filter(
    (key) => !read.has(key) && !read.has(base(key)) && !reached.some((shape) => shape.test(key))
  );
  expect(dead).toEqual([]);
});

/**
 * A key is built from a whole segment on - `sources.${label}` - and towards
 * keys that exist. A template that begins with a value, or in the middle of
 * a segment, reaches keys by accident of spelling and shelters them from the
 * check above; one that reaches nothing builds keys no bundle holds, or is
 * what is left of keys that were removed.
 */
it('builds a key only from a whole segment on, towards keys en holds', () => {
  const shown = (texts: string[]) => texts.join('${…}');
  expect(templates.filter(([head]) => !head.endsWith('.')).map(shown)).toEqual([]);
  expect(
    templates.filter((texts) => ![...en.keys()].some((key) => reach(texts).test(key))).map(shown)
  ).toEqual([]);
});
