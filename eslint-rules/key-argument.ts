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
// The estree types are not resolvable from here, and JSX has none in estree
// anyway, so a node is read by its `type` and whatever fields that type has.
export type Node = { type: string; [field: string]: unknown };

/** What TypeScript wraps an expression in without changing what it is. */
const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression']);

const unwrapped = (node: Node | undefined): Node | undefined =>
  node && WRAPPERS.has(node.type) ? unwrapped(node.expression as Node) : node;

export const literalOf = (wrapped: Node | undefined) => {
  const node = unwrapped(wrapped);
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return (node.quasis as { value: { cooked: string } }[])[0].value.cooked;
  }
  return undefined;
};

/**
 * The keys a first argument can name - a literal, or the literals of a ternary
 * - and whether a branch could not be read. `'a.b' as const` is the literal it
 * wraps.
 */
export const keysOf = (wrapped: Node | undefined): { keys: string[]; partial: boolean } => {
  const node = unwrapped(wrapped);
  if (node?.type === 'ConditionalExpression') {
    const [a, b] = [keysOf(node.consequent as Node), keysOf(node.alternate as Node)];
    return { keys: [...a.keys, ...b.keys], partial: a.partial || b.partial };
  }
  const key = literalOf(node);
  return key === undefined ? { keys: [], partial: true } : { keys: [key], partial: false };
};

/** The name a call calls: `t` for `t(…)` and for `i18n.t(…)`. */
export const calledName = (callee: Node): string | undefined =>
  callee.type === 'Identifier'
    ? (callee.name as string)
    : callee.type === 'MemberExpression' && !callee.computed
      ? ((callee.property as Node).name as string)
      : undefined;

/** The expression an attribute holds: `i18nKey="a.b"` and `i18nKey={key}` alike. */
export const attributeExpression = (attribute: Node) => {
  const value = attribute.value as Node | null;
  return value?.type === 'JSXExpressionContainer' ? (value.expression as Node) : (value ?? undefined);
};
