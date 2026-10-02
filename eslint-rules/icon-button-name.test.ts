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

import rule from './icon-button-name';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('icon-button-name', rule, {
  valid: [
    "<ActionIcon aria-label={t('header.language')}><IconLanguage /></ActionIcon>",
    "<CloseButton aria-label={t('form.plugins.clearSearch')} />",
    '<Burger opened={opened} aria-labelledby="nav-title" />',
    // A wrapper: whoever renders it names it.
    '<ActionIcon ref={ref} {...props} />',
    // Not an icon button: its text is its name.
    "<Button onClick={save}>{t('form.btn.save')}</Button>",
    // A group of them is not a button.
    '<ActionIcon.Group><ActionIcon aria-label="a" /></ActionIcon.Group>',
  ],
  invalid: [
    {
      code: '<ActionIcon onClick={refetch}><IconRefresh /></ActionIcon>',
      errors: [{ messageId: 'unnamed', data: { component: 'ActionIcon' } }],
    },
    {
      // A tooltip describes; it does not name.
      code: "<Tooltip label={t('form.btn.delete')}><ActionIcon onClick={remove}><IconDelete /></ActionIcon></Tooltip>",
      errors: [{ messageId: 'unnamed' }],
    },
    {
      code: '<CloseButton onClick={clear} />',
      errors: [{ messageId: 'unnamed', data: { component: 'CloseButton' } }],
    },
    {
      code: '<Burger opened={opened} onClick={toggle} />',
      errors: [{ messageId: 'unnamed', data: { component: 'Burger' } }],
    },
    {
      // A title is a tooltip in most browsers, and not reliably a name.
      code: '<ActionIcon title="x"><IconAdd /></ActionIcon>',
      errors: [{ messageId: 'unnamed' }],
    },
  ],
});
