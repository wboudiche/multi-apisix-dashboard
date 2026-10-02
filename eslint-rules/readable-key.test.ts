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
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from './readable-key';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const variable = [{ messageId: 'variable' }];

tester.run('readable-key', rule, {
  valid: [
    "t('a.b')",
    "t('a.b', { name })",
    "i18n.t('a.b')",
    "t(cond ? 'a.b' : 'c.d')",
    // What the text scan misread, one review at a time.
    "t(user?.isAdmin ? 'a.b' : 'c.d')",
    "t((cond ? 'a.b' : 'c.d'))",
    "t(a ? 'a.b' : b?.c ? 'c.d' : 'e.f')",
    "t('a.b' as const)",
    "t('a.b' /* why */)",
    "t<string>('a.b')",
    't(`a.b`)',
    // A comment is not a call.
    '// still typecheck against t().\nconst a = 1;',
    '<Trans i18nKey="a.b" />',
    "<Trans i18nKey={cond ? 'a.b' : 'c.d'} />",
    // t handed to a helper that takes it: the helper's own call is what is read.
    'roleLabel(t, role)',
    'other(key)',
    'const { t } = useTranslation()',
    'const { t, i18n } = useTranslation()',
    'const t = i18n.t.bind(i18n)',
    'const label = t("a.b")',
    // A `t` that is something else of that name: a token, a point in time, a
    // sample - on a line that has nothing to do with translations.
    'tokens.map((t) => Array.from(t))',
    'timers.forEach((t) => queue.find(t))',
    'items.map(render, t)',
    'Array.from(t)',
    'const time = point.t',
    'const { t: time } = point',
    'const v = sample.t as number',
    // The key is written, after the spread: it is the one that counts.
    '<Trans {...rest} i18nKey="a.b" />',
  ],
  invalid: [
    { code: 't(key)', errors: variable },
    { code: 't(entry.label)', errors: variable },
    { code: 'i18n.t(message as never)', errors: variable },
    { code: 't(`form.plugins.category.${category}`)', errors: variable },
    { code: "t(table[x] ?? 'a.b')", errors: variable },
    { code: "t(cond ? entry?.label : 'c.d')", errors: variable },
    { code: 't<string>(key)', errors: variable },
    // What does not look like `t(`.
    { code: '<Trans i18nKey={key} />', errors: variable },
    { code: 'keys.map(t)', errors: variable },
    { code: 'keys.map(i18n.t)', errors: variable },
    { code: 'keys.map(t as never)', errors: variable },
    { code: 'keys.some(t)', errors: variable },
    { code: 'Array.from(keys, t)', errors: variable },
    { code: '<Trans {...props} />', errors: variable },
    // One key, one report.
    { code: '<Trans {...rest} i18nKey={key} />', errors: variable },
    // A parameter that is the translate function, by its type.
    {
      code: 'const names = (t: TFunction, keys: string[]) => keys.map(t)',
      errors: variable,
    },
    {
      code: 'const { t } = useTranslation(); const names = keys.map(t)',
      errors: variable,
    },
    // Said where `t` is handed over, not where the chain begins: the line a
    // disable comment has to sit above.
    {
      code: 'keys\n  .filter(Boolean)\n  .map(t)',
      errors: [{ messageId: 'variable', line: 3 }],
    },
    // Under another name, no check reads its calls.
    { code: 'const { t: tr } = useTranslation(); tr(key)', errors: [{ messageId: 'alias' }] },
    { code: 'const translate = i18n.t', errors: [{ messageId: 'alias' }] },
  ],
});
