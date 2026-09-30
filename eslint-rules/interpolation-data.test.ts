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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

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
  friend_female: 'Ms {{surname}}',
  items_one: 'one item',
  items_other: 'several items',
  place_ordinal_one: '{{count}}st, {{where}}',
  place_ordinal_other: '{{count}}th, {{where}}',
  rank_one: '{{count}}, {{where}}',
  rank_other: '{{count}}, {{where}}',
  nest: '$t(greeting)!',
  filled: '$t(greeting, {"name": "x"})!',
  loop: '$t(loop) and {{once}}',
  status: 'Status',
  status_other: 'Another status: {{x}}',
  role: 'Role',
  role_admin: 'Admin {{who}}',
  role_settings: { title: '{{n}}' },
  user: 'Hi {{user.name}}',
  nested: { hint: 'Reset {{username}}', gone: null, list: ['{{item}}'] },
};

// The rule reads the catalogue from the file the plugin's setting names,
// relative to the working directory, so the fixture is written to disk.
const dir = mkdtempSync(path.join(tmpdir(), 'interpolation-'));
const translationPath = path.join(dir, 'en.json');
writeFileSync(translationPath, JSON.stringify(translation));
afterAll(() => rmSync(dir, { recursive: true }));

const settings = { i18n: { principalLangs: [{ name: 'en', translationPath }] } };
const renamed = { i18n: { ...settings.i18n, functionName: 'translate' } };

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
    { code: "t('routes', { count, replace: { name } })", settings },
    { code: "t('greeting', { name, defaultValue_one: 'x', defaultValue_other: 'y' })", settings },
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
    // A context or an ordinal picks a sibling at run time: all of them count -
    // the siblings, not the keys under a sibling object.
    { code: "t('friend', { context: 'male', name })", settings },
    { code: "t('friend', { context: gender, name, surname })", settings },
    // A context does not open the plural forms: `status_other` is not a sibling.
    { code: "t('status', { context: 'x' })", settings },
    // i18next's formatting and key-prefix options are instructions too.
    { code: "t('formatted', { date, formatParams: { date: { year: 'numeric' } } })", settings },
    { code: "t('role', { context: 'admin', who })", settings },
    // A plural form is only resolved with a count: `status_other` is not one here.
    { code: "t('status')", settings },
    // A dotted placeholder is walked from the value passed.
    { code: "t('user', { user })", settings },
    { code: "t('place', { count, ordinal: true, where })", settings },
    // An ordinal without ordinal forms falls back to the cardinal ones.
    { code: "t('rank', { count, ordinal: true, where })", settings },
    // A context i18next does not apply: nothing, an empty string.
    { code: "t('friend', { context: undefined })", settings },
    { code: "t('friend', { context: '' })", settings },
    // A nested $t() brings the other key's placeholders; a cycle ends.
    { code: "t('nest', { name })", settings },
    { code: "t('filled')", settings },
    { code: "t('loop', { once })", settings },
    // A ternary passes the union of what its keys need.
    { code: "t(both ? 'path' : 'greeting', { uri, name })", settings },
    // What cannot be read is left alone.
    { code: 't(key, { name })', settings },
    { code: "t(x ? 'plain' : key, { name })", settings },
    { code: "t(x ? 'greeting' : key, { name })", settings },
    { code: "t(x ? 'plain' : 'unknown.key', { name })", settings },
    { code: "t('greeting', opts)", settings },
    { code: "t('greeting', { ...opts })", settings },
    { code: "t('greeting', { [field]: x })", settings },
    { code: "t('unknown.key', { name })", settings },
    { code: "t('nested.gone', { name })", settings },
    { code: "t('nested.list', { item })", settings },
    // Not a translate call.
    { code: "other('greeting')", settings },
    { code: "handlers[t]('greeting')", settings },
    { code: "t('greeting')", settings: renamed },
    { code: "<Trans i18nKey='greeting' values={{ name }} />", settings },
    { code: "<Trans i18nKey='routes' count={n} values={{ name }} />", settings },
    { code: "<Trans i18nKey='routes' tOptions={{ count, name }} />", settings },
    { code: "<Trans i18nKey='greeting'>Hello {{ name }}</Trans>", settings },
    { code: "<Trans i18nKey='greeting'>Hello <b>{{ name }}</b></Trans>", settings },
    { code: "<Trans i18nKey='greeting'><>{{ name }}</></Trans>", settings },
    { code: "<Trans i18nKey='greeting'>{<b>{{ name }}</b>}</Trans>", settings },
    { code: "<Trans i18nKey='greeting'>{cond ? <b>{{ name }}</b> : null}</Trans>", settings },
    { code: "<Trans i18nKey='role' context='admin' values={{ who }} />", settings },
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
    // With a `replace` object, i18next reads nothing beside it.
    {
      code: "t('path', { replace: { uri }, name })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'path', placeholder: '{{name}}' } }],
    },
    {
      code: "t('rank', { count, ordinal: true })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'rank', placeholder: '{{where}}' } }],
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
    // A key that exists only as plural forms is missing its count - whether
    // or not a form spells {{count}}.
    {
      code: "t('routes', { name })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'routes', placeholder: '{{count}}' } }],
    },
    {
      code: "t('items')",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'items', placeholder: '{{count}}' } }],
    },
    {
      code: "t('friend', { context: gender, name })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'friend', placeholder: '{{surname}}' } }],
    },
    {
      code: "t(x ? 'greeting' : key)",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "t('status', { count })",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'status', placeholder: '{{x}}' } }],
    },
    // Said once, whatever the ternary repeats.
    {
      code: "t(a ? 'greeting' : 'greeting')",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'greeting', placeholder: '{{name}}' } }],
    },
    {
      code: "translate('greeting')",
      settings: renamed,
      errors: [{ messageId: 'missing' }],
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
      code: "<Trans i18nKey='role' context='admin' />",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'role', placeholder: '{{who}}' } }],
    },
    // A catalogue that cannot be read is said, on the file, not thrown.
    {
      code: "t('greeting')",
      settings: { i18n: { principalLangs: [{ name: 'en', translationPath: path.join(dir, 'missing.json') }] } },
      errors: [{ messageId: 'unreadable' }],
    },
    {
      code: "<Trans i18nKey='routes' values={{ name }} />",
      settings,
      errors: [{ messageId: 'missing', data: { key: 'routes', placeholder: '{{count}}' } }],
    },
  ],
});
