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
 * A button that shows only an icon names itself to whoever cannot see it.
 *
 * Mantine's ActionIcon, CloseButton and Burger render a button around an
 * icon, or around nothing. Without `aria-label` a screen reader announces
 * "button" and nothing else, and a test can reach it only by its class: the
 * language menu, the navigation toggles, the refresh of the routes list and
 * the delete and remove buttons of a dozen forms were all like that. A tooltip
 * does not name it - Mantine's describes, and only while it shows.
 *
 * `aria-labelledby` names it as well. A component that spreads its props
 * onto one is a wrapper, and its callers are the ones who name it.
 */
const ICON_BUTTONS = new Set(['ActionIcon', 'CloseButton', 'Burger']);

const NAMES = new Set(['aria-label', 'aria-labelledby']);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'require an accessible name on a button that shows only an icon' },
    schema: [],
    messages: {
      unnamed:
        'This {{component}} shows only an icon: give it an aria-label, translated, or a screen reader announces "button" and nothing else.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node: Rule.Node) {
        const element = node as unknown as {
          name: { type: string; name?: string };
          attributes: { type: string; name?: { name?: string } }[];
        };
        if (element.name.type !== 'JSXIdentifier' || !ICON_BUTTONS.has(element.name.name ?? '')) return;
        const named = element.attributes.some(
          (a) => a.type === 'JSXSpreadAttribute' || NAMES.has(a.name?.name ?? '')
        );
        if (!named) {
          context.report({ node, messageId: 'unnamed', data: { component: element.name.name ?? '' } });
        }
      },
    };
  },
};

export default rule;
