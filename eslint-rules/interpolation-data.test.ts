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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  friend: 'Friend',
  friend_male: 'Mr {{name}}',
  place_ordinal_one: '{{count}}st, {{where}}',
  place_ordinal_other: '{{count}}th, {{where}}',
  nest: '$t(greeting)!',
  loop: '$t(loop) and {{once}}',
  nested: { hint: 'Reset {{username}}', gone: null, list: ['{{item}}'] },
};

// The rule reads the catalogue from the file the plugin's setting names,
// relative to the working directory, so the fixture is written to disk.
const translationPath = path.join(mkdtempSync(path.join(tmpdir(), 'interpolation-')), 'en.json');
writeFileSync(translationPath, JSON.stringify(translation));

const settings = { i18n: { principalLangs: [{ name: 'en', translationPath }] } };

new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run('interpolation-data', rule, {
  valid: [
    { code: "t('plain')", settings },
    { code: "t('plain', 'Default text')", settings },
    { code: "t('greeting', { name })", settings },
    { code: "t('greeting', 'Hello', { name })", settings },
    { code: "t('greeting', { name: user.name })", settings },
    { code: "t('greeting', { 'name': x })", settings },
    { code: "t('greeting', { replace: { name } })", settings },
    { code: "t('path', { uri, name })", settings },
    { code: "t('formatted', { date })", settings },
    { code: "t('nested.hint', { username })", settings },
    { code: "i18n.t('greeting', { name })", settings },
    { code: 't(`greeting`, { name })', settings },
    // Plural forms: the placeholders of every form, and count is always allowed.
    { code: "t('routes', { count, name })", settings },
    { code: "t('plain', { count: 3 })", settings },
    // i18next's own options are not values for the text.
    { code: "t('greeting', { name, context: 'x', defaultValue: 'Hi' })", settings },
    { code: "t('plain', { interpolation: { escapeValue: false } })", settings },
    // A context or an ordinal picks a sibling at run time: all of them count.
    { code: "t('friend', { context: 'male', name })", settings },
    { code: "t('place', { count, ordinal: true, where })", settings },
    // A nested $t() brings the other key's placeholders; a cycle ends.
    { code: "t('nest', { name })", settings },
    { code: "t('loop', { once })", settings },
    // A ternary passes the union of what its keys need.
    { code: "t(both ? 'path' : 'greeting', { uri, name })", settings },
    // What cannot be read is left alone.
    { code: 't(key, { name })', settings },
    { code: "t(x ? 'plain' : key, { name })", settings },
    { code: "t(x ? 'plain' : 'unknown.key', { name })", settings },
    { code: "t('greeting', opts)", settings },
    { code: "t('greeting', { ...opts })", settings },
    { code: "t('greeting', { [field]: x })", settings },
    { code: "t('unknown.key', { name })", settings },
    { code: "t('nested.gone', { name })", settings },
    { code: "t('nested.list', { item })", settings },
    // Not a translate call.
    { code: "other('greeting')", settings },
    { code: "<Trans i18nKey='greeting' values={{ name }} />", settings },
    { code: "<Trans i18nKey='routes' count={n} values={{ name }} />", settings },
    { code: "<Trans i18nKey='routes' tOptions={{ count, name }} />", settings },
    { code: "<Trans i18nKey='greeting'>Hello {{ name }}</Trans>", settings },
    { code: "<Trans i18nKey='greeting' {...props} />", settings },
    { code: "<Trans i18nKey='plain' components={{ b: <b /> }} />", settings },
    // No catalogue configured: nothing to hold the call to.
    { code: "t('greeting')", settings: {} },
  ],
  invalid: [
    {
      code: "t('greeting')",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "t('greeting', 'Hello')",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "t('greeting', {})",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    // The renamed placeholder: the JSON says username, the call still says name.
    {
      code: "t('nested.hint', { name })",
      settings,
      errors: [
        { messageId: 'missing', data: { key: 'nested.hint', placeholder: '{{username}}' } },
        { messageId: 'unused', data: { key: 'nested.hint', name: '{{name}}' } },
      ],
    },
    {
      code: "t('plain', { name })",
      settings,
      errors: [{ messageId: 'unused', data: { key: 'plain', name: '{{name}}' } }],
    },
    {
      code: "t('path', { name })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'path', placeholder: '{{uri}}' } }],
    },
    {
      code: "t('routes', { count })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'routes', placeholder: '{{name}}' } }],
    },
    {
      code: "t('friend', { context: 'male' })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'friend', placeholder: '{{name}}' } }],
    },
    {
      code: "t('place', { count, ordinal: true })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'place', placeholder: '{{where}}' } }],
    },
    {
      code: "t('nest')",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'nest', placeholder: '{{name}}' } }],
    },
    {
      code: "t('greeting', 'Hello', { user })",
      settings,
      errors: [{ messageId: 'missing' }, { messageId: 'unused' }],
    },
    {
      code: "t(both ? 'path' : 'greeting', { name })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'path', placeholder: '{{uri}}' } }],
    },
    {
      code: "t(both ? 'path' : 'greeting', { uri, name, extra })",
      settings,
      errors: [{ messageId: 'unused', data: { key: "path' / 'greeting", name: '{{extra}}' } }],
    },
    // A branch that cannot be read still leaves the readable one held to what it needs.
    {
      code: "t(x ? 'greeting' : 'unknown.key', {})",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "i18n.t('greeting')",
      settings,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: "<Trans i18nKey='greeting' />",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "<Trans i18nKey={'greeting'} values={{ user }} />",
      settings,
      errors: [{ messageId: 'missing' }, { messageId: 'unused' }],
    },
    {
      code: "<Trans i18nKey='routes' values={{ name }} />",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'routes', placeholder: '{{count}}' } }],
    },
  ],
});
