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
import type { Rule } from 'eslint';

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
 */

/** i18next options that are instructions to it, not values for the text. */
const OPTIONS = new Set([
  'context',
  'count',
  'defaultValue',
  'fallbackLng',
  'interpolation',
  'joinArrays',
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

/** `{{name}}`, `{{- name}}` (unescaped) and `{{name, format}}`. */
const PLACEHOLDER = /\{\{-?\s*([^},\s]+)\s*(?:,[^}]*)?\}\}/g;

type Translation = { [key: string]: string | Translation };

const flatten = (node: Translation, prefix = '', out = new Map<string, string>()) => {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
};

const flattened = new WeakMap<Translation, Map<string, string>>();

/**
 * The placeholders a key interpolates, across its plural forms, or undefined
 * for a key the translation does not have.
 */
const placeholdersOf = (flat: Map<string, string>, key: string) => {
  const texts = [key, ...PLURAL_FORMS.map((form) => `${key}_${form}`)]
    .map((k) => flat.get(k))
    .filter((text): text is string => text !== undefined);
  if (texts.length === 0) return undefined;
  const names = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER)) names.add(match[1]);
  }
  return names;
};

// The estree types are not resolvable from here, and JSX has none in estree
// anyway, so a node is read by its `type` and whatever fields that type has.
type Node = { type: string; [field: string]: unknown };

/** The keys a first argument can name: a literal, or the literals of a ternary. */
const keysOf = (node: Node | undefined): string[] => {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return [(node.quasis as { value: { cooked: string } }[])[0].value.cooked];
  }
  if (node.type === 'ConditionalExpression') {
    return [...keysOf(node.consequent as Node), ...keysOf(node.alternate as Node)];
  }
  return [];
};

/**
 * The names an options object passes, or undefined when they cannot be read:
 * a variable, or a spread. A missing second argument, or a default text in
 * its place, passes none.
 */
const namesOf = (node: Node | undefined): Set<string> | undefined => {
  if (!node || (node.type === 'Literal' && typeof node.value === 'string')) return new Set();
  if (node.type !== 'ObjectExpression') return undefined;
  const names = new Set<string>();
  for (const property of node.properties as Node[]) {
    if (property.type !== 'Property' || property.computed) return undefined;
    const key = property.key as Node;
    if (key.type === 'Identifier') names.add(key.name as string);
    else if (key.type === 'Literal') names.add(String(key.value));
    else return undefined;
  }
  return names;
};

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'a t() call passes what its translation interpolates, and nothing else',
    },
    schema: [
      {
        type: 'object',
        properties: { translation: { type: 'object' } },
        required: ['translation'],
        additionalProperties: false,
      },
    ],
    messages: {
      missing: "'{{key}}' interpolates {{placeholder}}, which this call does not pass.",
      unused: "'{{key}}' has no {{name}} to interpolate.",
    },
  },

  create(context) {
    const translation = context.options[0].translation as Translation;
    let flat = flattened.get(translation);
    if (!flat) {
      flat = flatten(translation);
      flattened.set(translation, flat);
    }

    const check = (node: Rule.Node, keyNode: Node | undefined, optionsNode: Node | undefined) => {
      const names = namesOf(optionsNode);
      if (!names) return;
      const keys = keysOf(keyNode)
        .map((key) => ({ key, placeholders: placeholdersOf(flat!, key) }))
        .filter((k): k is { key: string; placeholders: Set<string> } => k.placeholders !== undefined);
      if (keys.length === 0) return;

      // Every key the call can pick must have what it interpolates.
      for (const { key, placeholders } of keys) {
        for (const placeholder of placeholders) {
          if (!names.has(placeholder)) {
            context.report({
              node,
              messageId: 'missing',
              data: { key, placeholder: `{{${placeholder}}}` },
            });
          }
        }
      }

      // A value is unused only when no key the call can pick interpolates it:
      // a ternary between keys that need different things passes their union.
      const interpolated = new Set(keys.flatMap(({ placeholders }) => [...placeholders]));
      for (const name of names) {
        if (!interpolated.has(name) && !OPTIONS.has(name)) {
          context.report({
            node,
            messageId: 'unused',
            data: { key: keys.map(({ key }) => key).join("' / '"), name: `{{${name}}}` },
          });
        }
      }
    };

    return {
      CallExpression(node) {
        const callee = node.callee as unknown as Node;
        const called =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression'
              ? (callee.property as Node).name
              : undefined;
        if (called !== 't') return;
        const [keyNode, optionsNode] = node.arguments as unknown as Node[];
        check(node, keyNode, optionsNode);
      },

      // <Trans i18nKey="…" values={{ … }} />
      JSXOpeningElement(node: Rule.Node) {
        const element = node as unknown as Node;
        if ((element.name as Node).name !== 'Trans') return;
        let keyNode: Node | undefined;
        let optionsNode: Node | undefined;
        for (const attribute of element.attributes as Node[]) {
          if (attribute.type !== 'JSXAttribute') continue;
          const name = (attribute.name as Node).name;
          const value = attribute.value as Node | null;
          if (name === 'i18nKey') {
            keyNode =
              value?.type === 'JSXExpressionContainer' ? (value.expression as Node) : (value ?? undefined);
          } else if (name === 'values') {
            optionsNode = value?.type === 'JSXExpressionContainer' ? (value.expression as Node) : undefined;
          }
        }
        check(node, keyNode, optionsNode);
      },
    };
  },
};

export default rule;
