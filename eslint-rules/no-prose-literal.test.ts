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

import rule from './no-prose-literal';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

tester.run('no-prose-literal', rule, {
  valid: [
    // A key, a constant, a path, a class name, a header: not sentences.
    "t('form.validation.nameRequired')",
    "const mode = 'custom'",
    "const header = 'X-Instance-ID'",
    "const path = '/apisix/admin/routes'",
    "const cls = 'mantine-Button-root primary'",
    "const title = 'ID'",
    // A word and a value: the scheme of a header, not a sentence.
    'const auth = `Bearer ${token}`',
    "const one = 'Upstream'",
    // What it does not see: a sentence that begins with a value. A net, not a
    // proof.
    'const s = `${count} routes could not be created`',
    // A list of fonts.
    "const style = { fontFamily: 'Outfit, sans-serif' }",
  ],
  invalid: [
    { code: "z.string().min(1, 'Name is required')", errors: [{ messageId: 'prose' }] },
    { code: "const step = { label: 'Define Upstream' }", errors: [{ messageId: 'prose' }] },
    { code: "throw new Error('No WSDL/XML files found in the ZIP archive.')", errors: [{ messageId: 'prose' }] },
    { code: "setError(text || 'Failed to save')", errors: [{ messageId: 'prose' }] },
    { code: 'const s = `Could not parse ${url}`', errors: [{ messageId: 'prose' }] },
    { code: "t('form.add', 'Add a Node')", errors: [{ messageId: 'prose' }] },
  ],
});
