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
  keysOf,
  type Node,
  underCasts,
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

/** Methods that call their first argument with each element of a list. */
const EACH = new Set(['map', 'flatMap', 'forEach', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast']);

type Definition = { type: string; node: Node; name: Node };
type Scope = { set: Map<string, { defs: Definition[] }>; upper: Scope | null };

/** How far a name is followed back to what it was given: `const a = t; const b = a`. */
const DEPTH = 3;

/** The instance, under the names it is imported by. */
const INSTANCES = new Set(['i18n', 'i18next']);

/** `TFunction`, `i18n.TFunction`, `typeof i18n.t`: a type that says translate function. */
const isTranslateType = (type: Node | undefined, functionName: string): boolean => {
  const nameOf = (node: Node | undefined): string =>
    node?.type === 'Identifier'
      ? (node.name as string)
      : node?.type === 'TSQualifiedName'
        ? `${nameOf(node.left as Node)}.${nameOf(node.right as Node)}`
        : '';
  if (type?.type === 'TSTypeReference') return /(^|\.)TFunction$/.test(nameOf(type.typeName as Node));
  if (type?.type === 'TSTypeQuery') return nameOf(type.exprName as Node).endsWith(`.${functionName}`);
  return false;
};

const annotationOf = (node: Node | undefined) =>
  (node?.typeAnnotation as Node | undefined)?.typeAnnotation as Node | undefined;

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

    /** What a name was defined as, or 'nowhere' for one this file does not define. */
    const definitionOf = (identifier: Node): Definition | 'nowhere' => {
      let scope = context.sourceCode.getScope(identifier as unknown as Rule.Node) as unknown as Scope | null;
      for (; scope; scope = scope.upper) {
        const [definition] = scope.set.get(identifier.name as string)?.defs ?? [];
        if (definition) return definition;
      }
      return 'nowhere';
    };

    /**
     * Whether an expression is something that has the translate function as
     * its `t`: the instance, what useTranslation() returns, or a name given
     * one of those.
     */
    const isSource = (wrapped: Node | null | undefined, depth = 0): boolean => {
      const node = underCasts(wrapped ?? undefined);
      if (node?.type === 'CallExpression') return calledName(node.callee as Node) === 'useTranslation';
      if (node?.type !== 'Identifier') return false;
      if (INSTANCES.has(node.name as string)) return true;
      const definition = definitionOf(node);
      if (definition === 'nowhere' || definition.type !== 'Variable' || depth >= DEPTH) return false;
      const { id, init } = definition.node as unknown as { id: Node; init: Node | null };
      return id.type === 'Identifier' && isSource(init, depth + 1);
    };

    /** Whether a parameter is the translate function: by its type, or by its default. */
    const isTranslateParameter = ({ node, name }: Definition): boolean => {
      for (const parameter of node.params as Node[]) {
        const pattern = parameter.type === 'AssignmentPattern' ? (parameter.left as Node) : parameter;
        if (pattern === name) {
          return (
            isTranslateType(annotationOf(name), functionName) ||
            (parameter.type === 'AssignmentPattern' && isTranslate(parameter.right as Node))
          );
        }
        if (pattern.type !== 'ObjectPattern') continue;
        const property = (pattern.properties as Node[]).find((p) => p.value === name);
        if (!property) continue;
        // ({ t }: { t: TFunction }): said in the pattern's own type. A named
        // type - Props - is not read: it may hold a `t` that is anything.
        const type = annotationOf(pattern);
        const member =
          type?.type === 'TSTypeLiteral'
            ? (type.members as Node[]).find((m) => (m.key as Node | undefined)?.name === functionName)
            : undefined;
        return (
          (property.key as Node).name === functionName &&
          isTranslateType(annotationOf(member), functionName)
        );
      }
      return false;
    };

    /**
     * Whether an expression is the translate function: `t` off a source, or a
     * name given it. Not everything called `t` is - a token in a loop, the
     * parameter of a callback, a field of a sample - and a rule that took
     * each for it failed the lint of code that has nothing to do with
     * translations.
     */
    function isTranslate(wrapped: Node | null | undefined, depth = 0): boolean {
      const node = underCasts(wrapped ?? undefined);
      if (node?.type === 'MemberExpression' && !node.computed) {
        return (node.property as Node).name === functionName && isSource(node.object as Node);
      }
      // i18n.t.bind(i18n), i18n.getFixedT(lng)
      if (node?.type === 'CallExpression' && (node.callee as Node).type === 'MemberExpression') {
        const method = calledName(node.callee as Node);
        const object = (node.callee as Node).object as Node;
        if (method === 'bind') return isTranslate(object, depth);
        if (method === 'getFixedT') return isSource(object);
      }
      if (node?.type !== 'Identifier') return false;
      const definition = definitionOf(node);
      if (definition === 'nowhere' || definition.type === 'ImportBinding') return node.name === functionName;
      if (definition.type === 'Parameter') return isTranslateParameter(definition);
      if (definition.type !== 'Variable' || depth >= DEPTH) return false;
      const { id, init } = definition.node as unknown as { id: Node; init: Node | null };
      if (id.type === 'Identifier') return isTranslate(init, depth + 1);
      if (id.type !== 'ObjectPattern') return false;
      const property = (id.properties as Node[]).find((p) => p.value === definition.name);
      return (property?.key as Node | undefined)?.name === functionName && isSource(init);
    }

    return {
      CallExpression(node) {
        const callee = node.callee as unknown as Node;
        const args = node.arguments as unknown as Node[];
        // keys.map(t), Array.from(keys, i18n.t): every element is a key, and
        // none is written here. Said on the argument, which is the line that
        // hands it over, however long the chain before it.
        if (callee.type === 'MemberExpression') {
          const method = calledName(callee) ?? '';
          const callback = EACH.has(method) ? args[0] : method === 'from' ? args[1] : undefined;
          if (callback && isTranslate(callback)) {
            report(callback, 'variable');
            return;
          }
        }
        const [first] = args;
        if (calledName(callee) !== functionName || !first) return;
        // handlers.forEach((t) => t(event)): a `t` that is something else.
        if (callee.type === 'Identifier' && !isTranslate(callee)) return;
        if (keysOf(first).partial) report(first, 'variable');
      },

      // const translate = t; const tr = i18n.t; const { t: tr } = useTranslation()
      VariableDeclarator(node) {
        const { id, init } = node as unknown as { id: Node; init: Node | null };
        if (id.type === 'Identifier') {
          if (id.name !== functionName && isTranslate(init)) report(id, 'alias');
          return;
        }
        if (id.type !== 'ObjectPattern' || !isSource(init)) return;
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
        const at = attributes.findIndex(
          (a) => a.type === 'JSXAttribute' && (a.name as Node).name === 'i18nKey'
        );
        const key = attributes[at];
        if (key && keysOf(attributeExpression(key)).partial) {
          report(key, 'variable');
          return;
        }
        // <Trans {...props}>: the key is in there, or nowhere - and a spread
        // after a key that is written may hold the one that counts.
        const spread = attributes.find((a, index) => a.type === 'JSXSpreadAttribute' && index > at);
        if (spread) report(spread, 'variable');
      },
    };
  },
};

export default rule;
