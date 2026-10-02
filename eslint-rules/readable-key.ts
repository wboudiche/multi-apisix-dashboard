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

import {
  attributeExpression,
  calledName,
  isTranslate,
  keysOf,
  type Node,
} from './key-argument';

/**
 * A translation key is written where it is asked for.
 *
 * A key handed to t() in a variable cannot be read by anything: not by
 * i18n/no-unknown-key, which then says nothing of a key no bundle holds, nor
 * by locale-keys.test.ts, which counts a key as read where a file spells it.
 *
 * The test used to refuse it itself, by scanning the source as text - cutting
 * the first argument out of each `t(` by counting brackets and quotes. Each
 * review found a shape of ordinary code that misread: a condition using `?.`,
 * a ternary in parentheses, `t()` in a comment, `'a.b' as const`. And it let
 * through what does not look like `t(`: `<Trans i18nKey={key}>`, `keys.map(t)`,
 * `t<T>(key)`, or `t` under another name. Where a variable key was the design, the exemption was the
 * whole file, so the next one on the same screen passed too (#365).
 *
 * Read from the syntax tree, there is nothing to count. A literal, or a
 * ternary of literals, is spelled; anything else is refused on its own line,
 * and says there where the keys it can be are spelled when that is the
 * design.
 *
 * The function name is the i18n plugin's own setting, `settings.i18n`.
 */

/** Methods that call what they are given with each element of a list. */
const EACH = new Set([
  'map',
  'flatMap',
  'forEach',
  'filter',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'from',
]);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'a translation key is a literal, or a ternary of literals' },
    schema: [],
    messages: {
      variable:
        'This key cannot be read: nothing checks that the bundles hold it. Spell it - a literal, or a ternary of literals - or say on this line where the keys it can be are spelled.',
      alias:
        'Under another name, the calls on this are not read as translations: no check sees their keys. Call it {{name}}.',
    },
  },

  create(context) {
    const i18n = context.settings.i18n as { functionName?: string } | undefined;
    const functionName = i18n?.functionName ?? 't';
    const report = (node: Node, messageId: 'variable' | 'alias') =>
      context.report({ node: node as unknown as Rule.Node, messageId, data: { name: functionName } });

    return {
      CallExpression(node) {
        const callee = node.callee as unknown as Node;
        const args = node.arguments as unknown as Node[];
        // keys.map(t), Array.from(keys, i18n.t): every element is a key, and
        // none is written here. Said on the argument, which is the line that
        // hands it over, however long the chain before it.
        if (callee.type === 'MemberExpression' && EACH.has(calledName(callee) ?? '')) {
          const handed = args.find((argument) => isTranslate(argument, functionName));
          if (handed) {
            report(handed, 'variable');
            return;
          }
        }
        const [first] = args;
        if (calledName(callee) !== functionName || !first) return;
        if (keysOf(first).partial) report(first, 'variable');
      },

      // const translate = t; const { t: tr } = useTranslation()
      VariableDeclarator(node) {
        const { id, init } = node as unknown as { id: Node; init: Node | null };
        if (id.type === 'Identifier' && id.name !== functionName && isTranslate(init ?? undefined, functionName)) {
          report(id, 'alias');
        }
        if (id.type !== 'ObjectPattern') return;
        for (const property of id.properties as Node[]) {
          if (property.type !== 'Property' || property.computed) continue;
          const value = property.value as Node;
          if (
            (property.key as Node).name === functionName &&
            value.type === 'Identifier' &&
            value.name !== functionName
          ) {
            report(value, 'alias');
          }
        }
      },

      JSXOpeningElement(node: Rule.Node) {
        const opening = node as unknown as Node;
        if ((opening.name as Node).name !== 'Trans') return;
        const attributes = opening.attributes as Node[];
        // <Trans {...props}>: the key is in there, or nowhere.
        const spread = attributes.find((a) => a.type === 'JSXSpreadAttribute');
        if (spread) report(spread, 'variable');
        const key = attributes.find(
          (a) => a.type === 'JSXAttribute' && (a.name as Node).name === 'i18nKey'
        );
        if (key && keysOf(attributeExpression(key)).partial) report(key, 'variable');
      },
    };
  },
};

export default rule;
