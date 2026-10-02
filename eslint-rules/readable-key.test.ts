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
  ],
});
