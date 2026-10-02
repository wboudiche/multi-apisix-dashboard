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
 * A sentence written as a string is English in every language.
 *
 * i18next/no-literal-string reads what sits in JSX here - its other mode
 * reports every class name and field path in the codebase, three thousand of
 * them. So a sentence outside JSX went unseen: a zod message, a step's label
 * in a table above the JSX, the fallback of a failed save, an error thrown by
 * a parser. Forty of them were on screen in English whatever the language
 * (#364), and each time one screen was translated the next was written the
 * same way.
 *
 * What it takes for a sentence: a string, or the text of a template, that
 * begins with a capitalised word followed by another word - "Name is
 * required", "Define Upstream". Not a constant, a path, a class name or a
 * key. What it misses, it misses: a sentence that begins in lower case, or
 * with a value. It is a net, not a proof - that every key exists in every
 * language is held by src/config/locale-keys.test.ts.
 *
 * A string that is this shape and is not for a reader - a product's name, a
 * sentence compared with a gateway's - says so on its own line, with the
 * reason.
 */
const SENTENCE = /^[A-Z][a-z]+ \w/;

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'refuse a sentence written as a string instead of a translation key' },
    schema: [],
    messages: {
      prose:
        'A sentence in a string is English in every language (#364): give it a key and translate it, or say on this line why no reader sees it.',
    },
  },
  create(context) {
    const check = (node: Rule.Node, text: string) => {
      if (SENTENCE.test(text)) context.report({ node, messageId: 'prose' });
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node as unknown as Rule.Node, node.value.raw);
      },
    };
  },
};

export default rule;
