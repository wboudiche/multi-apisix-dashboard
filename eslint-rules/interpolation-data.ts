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
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Rule } from 'eslint';

import { placeholdersIn } from '../src/config/placeholders';

/**
 * A call site passes what its translation interpolates, and nothing else.
 *
 * `t('users.resetHint')` with an `en` text of "…{{username}}…" renders a blank
 * where the name should be, and i18next says nothing. The rule that came with
 * the i18n plugin could not see this: it expects the values under a `data`
 * property (`t(key, { data: { username } })`, the shape of its author's own
 * translate function), so every i18next call, `t(key, { username })`, read as
 * passing nothing - 129 reports, all wrong, the day its pattern was corrected
 * (#326). This one reads the options the way i18next does.
 *
 * Both directions are checked, by name. A placeholder the call does not pass
 * renders blank; a value the text has no placeholder for is what a renamed
 * placeholder leaves behind at the call site - `{{name}}` became `{{username}}`
 * in the JSON, and the call still says `name`. The translations are held to
 * `en`'s placeholders by src/config/locale-keys.test.ts; this holds the source.
 *
 * What it cannot see, it leaves alone: a key held in a variable, options
 * spread from one, a key `en` does not have (i18n/no-unknown-key reports that).
 *
 * The catalogue and the function name are the plugin's own settings,
 * `settings.i18n`, so each is named once for both.
 */

/** i18next options that are instructions to it, not values for the text. */
const OPTIONS = new Set([
  'context',
  'count',
  'defaultValue',
  'fallbackLng',
  'formatParams',
  'interpolation',
  'joinArrays',
  'keyPrefix',
  'keySeparator',
  'lng',
  'lngs',
  'ns',
  'nsSeparator',
  'ordinal',
  'postProcess',
  'replace',
  'returnDetails',
  'returnObjects',
  'skipInterpolation',
]);

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * `$t(other.key)`: the other key's placeholders count too - unless the nested
 * call carries values of its own, `$t(other.key, {"name": "x"})`, which is
 * then what fills them.
 */
const NESTED = /\$t\(\s*([^,)\s]+)\s*(,)?/g;

type Catalogue = Map<string, string>;

/** Every string leaf, as the dotted key i18next resolves. Anything else has no text. */
const flatten = (node: unknown, prefix = '', out: Catalogue = new Map()) => {
  if (typeof node === 'string') {
    out.set(prefix, node);
  } else if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
};

const catalogues = new Map<string, { modified: number; catalogue: Catalogue }>();

/** The catalogue in a file, re-read when the file changes under an editor's lint server. */
const catalogueAt = (file: string) => {
  const resolved = path.resolve(process.cwd(), file);
  const modified = statSync(resolved).mtimeMs;
  let entry = catalogues.get(resolved);
  if (!entry || entry.modified !== modified) {
    entry = { modified, catalogue: flatten(JSON.parse(readFileSync(resolved, 'utf8'))) };
    catalogues.set(resolved, entry);
  }
  return entry.catalogue;
};

/**
 * What the call passes that decides which form of a key i18next resolves: a
 * `count` opens the plural forms, an `ordinal` the ordinal ones, a `context`
 * a sibling - the one it names when it is a literal, any when it is not.
 */
type Selectors = { count: boolean; ordinal: boolean; context: string | true | undefined };

/**
 * The keys i18next may resolve a key to, given what the call passes, in the
 * shape the catalogue spells them: `key`, `key_<context>`, and the plural forms
 * `…_one` / `…_ordinal_one` of each when a count is there.
 */
const formsOf = (catalogue: Catalogue, key: string, { count, ordinal, context }: Selectors) => {
  const bases = [key];
  if (context === true) {
    // The sibling i18next picks is only known at run time: any `key_<x>` that
    // is not itself a plural form, and not a key under a `key_…` object.
    for (const k of catalogue.keys()) {
      const suffix = k.startsWith(`${key}_`) ? k.slice(key.length + 1) : undefined;
      if (suffix && !suffix.includes('.') && !PLURAL_FORMS.includes(suffix.replace(/^ordinal_/, ''))) {
        bases.push(k);
      }
    }
  } else if (context) {
    bases.push(`${key}_${context}`);
  }
  // An ordinal falls back to the cardinal forms when it has none of its own.
  const plural = (base: string) =>
    PLURAL_FORMS.flatMap((form) => (ordinal ? [`${base}_ordinal_${form}`, `${base}_${form}`] : [`${base}_${form}`]));
  // A key that exists as plural forms only resolves to one of them with the
  // count the call does not pass: those forms, and that count.
  const pluralOnly = !count && !bases.some((b) => catalogue.has(b)) && plural(key).some((k) => catalogue.has(k));
  return {
    pluralOnly,
    forms: count || pluralOnly ? bases.flatMap((base) => [base, ...plural(base)]) : bases,
  };
};

/**
 * The placeholders a key interpolates, by the first segment of their path
 * (`{{user.name}}` is walked from the `user` the call passes), or undefined
 * for a key the catalogue does not have. A key that exists as plural forms
 * only needs the `count` that picks one. A `$t(other)` nested in a text
 * brings the other key's placeholders with it.
 */
const placeholdersOf = (
  catalogue: Catalogue,
  key: string,
  selectors: Selectors,
  seen = new Set<string>()
): Set<string> | undefined => {
  const { forms, pluralOnly } = formsOf(catalogue, key, selectors);
  const texts = forms.map((k) => catalogue.get(k)).filter((t): t is string => t !== undefined);
  if (texts.length === 0) return undefined;
  const names = new Set<string>(pluralOnly ? ['count'] : []);
  for (const text of texts) {
    for (const placeholder of placeholdersIn(text)) names.add(placeholder.split('.')[0]);
    for (const [, nested, ownValues] of text.matchAll(NESTED)) {
      if (ownValues || seen.has(nested)) continue;
      seen.add(nested);
      for (const name of placeholdersOf(catalogue, nested, selectors, seen) ?? []) names.add(name);
    }
  }
  return names;
};

// The estree types are not resolvable from here, and JSX has none in estree
// anyway, so a node is read by its `type` and whatever fields that type has.
type Node = { type: string; [field: string]: unknown };

const literalOf = (node: Node | undefined) => {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return (node.quasis as { value: { cooked: string } }[])[0].value.cooked;
  }
  return undefined;
};

/**
 * The keys a first argument can name - a literal, or the literals of a ternary
 * - and whether a branch could not be read. The keys it does name are still
 * held to what they interpolate; what the whole call may pass is not known.
 */
const keysOf = (node: Node | undefined): { keys: string[]; partial: boolean } => {
  if (node?.type === 'ConditionalExpression') {
    const [a, b] = [keysOf(node.consequent as Node), keysOf(node.alternate as Node)];
    return { keys: [...a.keys, ...b.keys], partial: a.partial || b.partial };
  }
  const key = literalOf(node);
  return key === undefined ? { keys: [], partial: true } : { keys: [key], partial: false };
};

/** What a call passes: each name, with its value where the rule wants to read one. */
type Passed = Map<string, Node | undefined>;

/**
 * The names an options object passes, or undefined when they cannot be read:
 * a variable, a spread, a computed name. No object passes none.
 */
const passedBy = (node: Node | undefined, into: Passed = new Map()): Passed | undefined => {
  if (!node) return into;
  if (node.type !== 'ObjectExpression') return undefined;
  for (const property of node.properties as Node[]) {
    if (property.type !== 'Property' || property.computed) return undefined;
    const key = property.key as Node;
    const name = key.type === 'Identifier' ? (key.name as string) : key.type === 'Literal' ? String(key.value) : undefined;
    if (name === undefined) return undefined;
    into.set(name, property.value as Node);
  }
  return into;
};

/**
 * The values the text is filled from: what `replace` holds when it is an
 * object - i18next then reads nothing beside it - and the options themselves
 * otherwise.
 */
const valuesOf = (passed: Passed) => {
  const replace = passed.get('replace');
  return replace?.type === 'ObjectExpression' ? passedBy(replace) : passed;
};

/** `defaultValue`, and the `defaultValue_one` / `defaultValue_<context>` i18next reads beside it. */
const isOption = (name: string) => OPTIONS.has(name) || name.startsWith('defaultValue_');

/** A context i18next applies: a non-empty string or a number, or one only known at run time. */
const contextOf = (node: Node | undefined): string | true | undefined => {
  if (!node) return undefined;
  if (node.type === 'Identifier' && node.name === 'undefined') return undefined;
  if (node.type === 'Literal') {
    const { value } = node;
    return typeof value === 'number' || (typeof value === 'string' && value !== '') ? String(value) : undefined;
  }
  return literalOf(node) ?? true;
};

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'a t() call passes what its translation interpolates, and nothing else',
    },
    schema: [],
    messages: {
      missing: "'{{key}}' interpolates {{placeholder}}, which this call does not pass.",
      unused: "'{{key}}' has no {{name}} to interpolate.",
      unreadable: 'The catalogue settings.i18n.principalLangs names, {{file}}, could not be read: {{reason}}',
    },
  },

  create(context) {
    const i18n = context.settings.i18n as
      | { principalLangs?: { translationPath: string }[]; functionName?: string }
      | undefined;
    const [principal] = i18n?.principalLangs ?? [];
    if (!principal) return {};
    const functionName = i18n?.functionName ?? 't';

    let catalogue: Catalogue;
    try {
      catalogue = catalogueAt(principal.translationPath);
    } catch (error) {
      // Said on each file rather than thrown: a rule that throws takes the
      // whole run down with a stack trace, in place of a message that names
      // the setting to fix (#343).
      return {
        Program(node) {
          const reason = error instanceof Error ? error.message : String(error);
          context.report({ node, messageId: 'unreadable', data: { file: principal.translationPath, reason } });
        },
      };
    }

    const check = (node: Rule.Node, keyNode: Node | undefined, passed: Passed | undefined) => {
      const { keys, partial } = keysOf(keyNode);
      const values = passed && valuesOf(passed);
      if (!passed || !values || keys.length === 0) return;
      const selectors: Selectors = {
        count: passed.has('count'),
        ordinal: passed.has('ordinal'),
        context: contextOf(passed.get('context')),
      };
      const known = keys.map((key) => ({ key, placeholders: placeholdersOf(catalogue, key, selectors) }));

      // Every key the call can pick must have what it interpolates - said once
      // per key and placeholder, whatever the shape of the ternary.
      const reported = new Set<string>();
      for (const { key, placeholders } of known) {
        for (const placeholder of placeholders ?? []) {
          const filled = values.has(placeholder) || (placeholder === 'count' && passed.has('count'));
          if (filled || reported.has(`${key} ${placeholder}`)) continue;
          reported.add(`${key} ${placeholder}`);
          context.report({ node, messageId: 'missing', data: { key, placeholder: `{{${placeholder}}}` } });
        }
      }

      // A value is unused only when no key the call can pick interpolates it:
      // a ternary between keys that need different things passes their union
      // - which is not known while one of its keys cannot be read, or is not
      // in the catalogue.
      if (partial || known.some(({ placeholders }) => placeholders === undefined)) return;
      const interpolated = new Set(known.flatMap(({ placeholders }) => [...placeholders!]));
      for (const name of values.keys()) {
        if (!interpolated.has(name) && !isOption(name)) {
          context.report({
            node,
            messageId: 'unused',
            data: { key: keys.join("' / '"), name: `{{${name}}}` },
          });
        }
      }
    };

    return {
      // t(key, options) and t(key, 'default text', options)
      CallExpression(node) {
        const callee = node.callee as unknown as Node;
        const called =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && !callee.computed
              ? (callee.property as Node).name
              : undefined;
        if (called !== functionName) return;
        const [keyNode, second, third] = node.arguments as unknown as Node[];
        check(node, keyNode, passedBy(literalOf(second) === undefined ? second : third));
      },

      // <Trans i18nKey="…" values={{ … }} count={n} context="…" tOptions={{ … }}>…{{ name }}…</Trans>
      JSXElement(node: Rule.Node) {
        const element = node as unknown as Node;
        const opening = element.openingElement as Node;
        if ((opening.name as Node).name !== 'Trans') return;
        const expressionOf = (attribute: Node) => {
          const value = attribute.value as Node | null;
          return value?.type === 'JSXExpressionContainer' ? (value.expression as Node) : (value ?? undefined);
        };
        const key = (opening.attributes as Node[]).find(
          (a) => a.type === 'JSXAttribute' && (a.name as Node).name === 'i18nKey'
        );
        const passed = (): Passed | undefined => {
          const into: Passed = new Map();
          for (const attribute of opening.attributes as Node[]) {
            if (attribute.type !== 'JSXAttribute') return undefined; // {...props}
            const name = (attribute.name as Node).name as string;
            if (name === 'count' || name === 'context') into.set(name, expressionOf(attribute));
            else if ((name === 'values' || name === 'tOptions') && !passedBy(expressionOf(attribute), into)) {
              return undefined;
            }
          }
          // Children interpolate too, at any depth: <Trans i18nKey="k">Hello <b>{{ name }}</b></Trans>.
          // A child chosen at run time - `{cond ? <b>{{ name }}</b> : null}` - cannot be read.
          const fromChildren = (children: Node[]): boolean =>
            children.every((child) => {
              if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
                return fromChildren(child.children as Node[]);
              }
              if (child.type !== 'JSXExpressionContainer') return true;
              const expression = child.expression as Node;
              if (expression.type === 'ObjectExpression') return passedBy(expression, into) !== undefined;
              if (expression.type === 'JSXElement' || expression.type === 'JSXFragment') return fromChildren([expression]);
              return !['ConditionalExpression', 'LogicalExpression'].includes(expression.type);
            });
          return fromChildren(element.children as Node[]) ? into : undefined;
        };
        check(node, key && expressionOf(key), passed());
      },
    };
  },
};

export default rule;
