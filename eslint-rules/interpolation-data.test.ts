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
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './interpolation-data';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const translation = {
  plain: 'No placeholder here',
  greeting: 'Hello {{name}}',
  path: 'At {{- uri}} for {{name}}',
  formatted: 'Since {{date, datetime}}',
  routes_one: '{{count}} route on {{name}}',
  routes_other: '{{count}} routes on {{name}}',
  nested: { hint: 'Reset {{username}}' },
};

const options = [{ translation }];

new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run('interpolation-data', rule, {
  valid: [
    { code: "t('plain')", options },
    { code: "t('plain', 'Default text')", options },
    { code: "t('greeting', { name })", options },
    { code: "t('greeting', { name: user.name })", options },
    { code: "t('greeting', { 'name': x })", options },
    { code: "t('path', { uri, name })", options },
    { code: "t('formatted', { date })", options },
    { code: "t('nested.hint', { username })", options },
    { code: "i18n.t('greeting', { name })", options },
    // Plural forms: the placeholders of every form, and count is always allowed.
    { code: "t('routes', { count, name })", options },
    { code: "t('plain', { count: 3 })", options },
    // i18next's own options are not values for the text.
    { code: "t('greeting', { name, context: 'male', defaultValue: 'Hi' })", options },
    { code: "t('plain', { interpolation: { escapeValue: false } })", options },
    // A ternary passes the union of what its keys need.
    { code: "t(both ? 'path' : 'greeting', { uri, name })", options },
    // What cannot be read is left alone.
    { code: 't(key, { name })', options },
    { code: "t('greeting', opts)", options },
    { code: "t('greeting', { ...opts })", options },
    { code: "t('greeting', { [field]: x })", options },
    { code: "t('unknown.key', { name })", options },
    { code: 't(`greeting`, { name })', options },
    // Not a translate call.
    { code: "other('greeting')", options },
    { code: "<Trans i18nKey='greeting' values={{ name }} />", options },
    { code: "<Trans i18nKey='plain' components={{ b: <b /> }} />", options },
  ],
  invalid: [
    {
      code: "t('greeting')",
      options,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "t('greeting', 'Hello')",
      options,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "t('greeting', {})",
      options,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    // The renamed placeholder: the JSON says username, the call still says name.
    {
      code: "t('nested.hint', { name })",
      options,
      errors: [
        { messageId: 'missing', data: { key: 'nested.hint', placeholder: '{{username}}' } },
        { messageId: 'unused', data: { key: 'nested.hint', name: '{{name}}' } },
      ],
    },
    {
      code: "t('plain', { name })",
      options,
      errors: [{ messageId: 'unused', data: { key: 'plain', name: '{{name}}' } }],
    },
    {
      code: "t('path', { name })",
      options,
      errors: [{ messageId: 'missing', data: { key: 'path', placeholder: '{{uri}}' } }],
    },
    {
      code: "t('routes', { count })",
      options,
      errors: [{ messageId: 'missing', data: { key: 'routes', placeholder: '{{name}}' } }],
    },
    {
      code: "t(both ? 'path' : 'greeting', { name })",
      options,
      errors: [{ messageId: 'missing', data: { key: 'path', placeholder: '{{uri}}' } }],
    },
    {
      code: "t(both ? 'path' : 'greeting', { uri, name, extra })",
      options,
      errors: [{ messageId: 'unused', data: { key: "path' / 'greeting", name: '{{extra}}' } }],
    },
    {
      code: "i18n.t('greeting')",
      options,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: "<Trans i18nKey='greeting' />",
      options,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "<Trans i18nKey={'greeting'} values={{ user }} />",
      options,
      errors: [{ messageId: 'missing' }, { messageId: 'unused' }],
    },
  ],
});
