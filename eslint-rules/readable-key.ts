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

import { attributeExpression, calledName, keysOf, type Node } from './key-argument';

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
 * `t<T>(key)`. Where a variable key was the design, the exemption was the
 * whole file, so the next one on the same screen passed too (#365).
 *
 * Read from the syntax tree, there is nothing to count. A literal, or a
 * ternary of literals, is spelled; anything else is refused on its own line,
 * and says there where the keys it can be are spelled when that is the
 * design.
 *
 * The function name is the i18n plugin's own setting, `settings.i18n`.
 */

/** Array methods that call what they are given with each element. */
const EACH = new Set(['map', 'flatMap', 'forEach']);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'a translation key is a literal, or a ternary of literals' },
    schema: [],
    messages: {
      variable:
        'This key cannot be read: nothing checks that the bundles hold it. Spell it - a literal, or a ternary of literals - or say on this line where the keys it can be are spelled.',
    },
  },

  create(context) {
    const i18n = context.settings.i18n as { functionName?: string } | undefined;
    const functionName = i18n?.functionName ?? 't';

    return {
      CallExpression(node) {
        const callee = node.callee as unknown as Node;
        const [first] = node.arguments as unknown as Node[];
        // keys.map(t): every element is a key, and none is written here.
        if (
          callee.type === 'MemberExpression' &&
          EACH.has(calledName(callee) ?? '') &&
          first?.type === 'Identifier' &&
          first.name === functionName
        ) {
          context.report({ node, messageId: 'variable' });
          return;
        }
        if (calledName(callee) !== functionName || !first) return;
        if (keysOf(first).partial) context.report({ node: first as unknown as Rule.Node, messageId: 'variable' });
      },

      JSXOpeningElement(node: Rule.Node) {
        const opening = node as unknown as Node;
        if ((opening.name as Node).name !== 'Trans') return;
        const key = (opening.attributes as Node[]).find(
          (a) => a.type === 'JSXAttribute' && (a.name as Node).name === 'i18nKey'
        );
        if (key && keysOf(attributeExpression(key)).partial) {
          context.report({ node: key as unknown as Rule.Node, messageId: 'variable' });
        }
      },
    };
  },
};

export default rule;
