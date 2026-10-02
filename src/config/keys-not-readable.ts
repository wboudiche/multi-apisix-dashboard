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

/**
 * Where a translation key is built rather than spelled.
 *
 * Every key `en` has must exist in every language: that is one check over the
 * five bundles in locale-keys.test.ts, and needs no list (#362). What goes
 * file by file is the source: every dotted string a file spells is held to
 * being a key `en` holds, so that a key mistyped inside a ternary - which
 * eslint's i18n/no-unknown-key does not descend into - is reported by name;
 * and a key handed to the translate function in a variable is refused, since nothing could read
 * it. Both began as a list of screens that had been worked through (#328) and
 * now cover all of src/, so this names the exceptions, with the reason.
 */

/**
 * The files that hand the translate function a key held in a variable, where that is the design.
 * They are still held to spelling real keys everywhere else; only the refusal
 * of a variable key is lifted.
 */
export const KEYS_BUILT_FROM_VARIABLES = [
  'src/components/Navbar.tsx', // `sources.${route.label}`
  'src/components/form-slice/FormItemPlugins/PluginCard.tsx', // `form.plugins.category.${category}`
  'src/components/form-slice/FormItemPlugins/PluginEditorDrawer.tsx',
  'src/components/form-slice/FormItemPlugins/SelectPluginsDrawer.tsx',
  'src/components/form-slice/FormPartBasic.tsx', // `form.basic.statusOption.${status}`
  'src/components/form-slice/FormPartStreamRoute/index.tsx', // the key is in a variable, `confHelp.noteKey`
  'src/components/form-slice/FormPartUpstream/TestConnectionButton.tsx', // the key is in a variable, `limited`
  'src/components/page/ImportWsdlModal.tsx', // the key is in a variable, `limited`
  'src/components/page/ListWarningBanner.tsx', // the key is looked up in a table, with a literal fallback
  'src/components/page/RouteTestDrawer.tsx', // the key is in a variable, `named`
  'src/config/role-labels.ts', // the key is a parameter; the keys it can be are `roleLabelKeys`, checked on their own
  'src/routes/instances/index.tsx', // the key is in a field of a table row, `entry.label`
  'src/utils/error-text.ts', // the key is the message a schema wrote, checked where the schema spells it
  'src/utils/policy-refusal.ts', // the key is looked up in a table, by the backend's code
];

/**
 * The keys those files can reach, by prefix: everything under one is read
 * through a variable, so a key there is not dead for being spelled by no file.
 */
export const KEY_PREFIXES_BUILT = [
  'sources.',
  'form.plugins.category.',
  'form.basic.statusOption.',
];
