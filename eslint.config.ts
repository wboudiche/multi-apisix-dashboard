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
import js from '@eslint/js'
import i18n from '@m6web/eslint-plugin-i18n';
import headers from 'eslint-plugin-headers';
import i18next from 'eslint-plugin-i18next';
// The plugin's own defaults, imported rather than copied: naming an option
// replaces its default wholesale, and a hand-copied list stops being the
// plugin's the moment the plugin changes it.
import i18nextDefaults from 'eslint-plugin-i18next/lib/options/defaults';
import * as importPlugin from 'eslint-plugin-import';
import playwright from 'eslint-plugin-playwright'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import interpolationData from './eslint-rules/interpolation-data';
import noProseLiteral from './eslint-rules/no-prose-literal';

const importRules = tseslint.config({
  plugins: {
    'unused-imports': unusedImports,
    'simple-import-sort': simpleImportSort,
    import: importPlugin,
  },
  rules: {
    ...importPlugin.flatConfigs?.recommended.rules,
    ...importPlugin.flatConfigs?.typescript.rules,
    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-duplicates': 'error',
    'import/no-unresolved': 'off',
    'import/no-named-as-default-member': 'off',
  },
});

const commonRules = tseslint.config({
  extends: [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    importRules,
  ],
  plugins: {
    headers: headers,
  },
  rules: {
    'headers/header-format': [
      'error',
      {
        source: 'file',
        path: '.actions/ASFLicenseHeader.txt',
      },
    ],
    quotes: [
      'error',
      'single',
      {
        avoidEscape: true,
        allowTemplateLiterals: false,
      },
    ],
  },
});

const e2eRules = tseslint.config(
  {
    extends: [commonRules],
    files: ['e2e/**/*.ts'],
  },
  {
    files: ['e2e/**/*.spec.ts'],
    ...playwright.configs['flat/recommended'],
  },
  {
    // A name is matched by substring, and a row's name is also in the name of
    // the checkbox that selects it - so a cell asked for by name is two cells
    // (#372). The helpers say which one, once.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='getByRole'][arguments.0.value='cell'] > ObjectExpression > Property[key.name='name']",
          message:
            'A cell asked for by name also matches the cell of the row checkbox - use uiCell or uiCellsShowing from @e2e/utils/ui.',
        },
      ],
    },
  }
);

/**
 * Attributes are held to i18n as well as text, on every screen.
 *
 * The plugin's recommended mode is jsx-text-only, which never looks at an
 * attribute, and i18n/no-text-as-attribute covers alt and title alone - which
 * is how thirteen strings came to be written in English on the Users page
 * (#320). This ran screen by screen while the 97 occurrences it reported were
 * worked through (#328); there are none left, so it is no longer a list.
 *
 * What it reports that is not a sentence - an example in a placeholder, a value
 * the gateway spells - is disabled on its own line, with the reason beside it,
 * rather than excluded here by shape: an exclusion applies to every literal the
 * rule sees, and the two below are each kept to the one screen that needs it.
 *
 * It holds what sits in JSX, not the whole screen: a string in a
 * `notifications.show` object, or in a table of labels built above the JSX, has
 * no JSX ancestor, so this mode never sees it (thirteen of them sat on the
 * instances page). A quiet rule does not make a screen translated - that every
 * key exists in every language is held by src/config/locale-keys.test.ts.
 */
const attributeRuleOptions = {
  mode: 'jsx-only',
  // The attributes whose contents are read: a literal in one is prose,
  // and - since naming an attribute is also what makes the rule walk
  // inside it - a literal anywhere under one is too. That second half is
  // why the render props are here: `renderOption={() => <span>Draft</span>}`
  // is text on the screen, and an attribute left off this list hides what
  // it holds rather than merely being unchecked itself.
  'jsx-attributes': {
    include: [
      'label',
      'placeholder',
      'description',
      'title',
      'aria-label',
      // Mantine renders `error` under the field it belongs to and
      // `nothingFoundMessage` inside an empty select: both are sentences
      // an operator reads at the moment something has gone wrong.
      'error',
      'nothingFoundMessage',
      'data',
      'renderOption',
      'leftSection',
      'rightSection',
    ],
  },
  // Named the other way round: an option's fields are prose unless said
  // otherwise, so a grouped `data` - Mantine's `{ group, items: [...] }` -
  // is walked to the labels inside it, which an include list could not
  // reach past `group`. Out: `value`, which is the id a select matches on;
  // `style`, through which the language menu spreads a CSS variable; and
  // SCREAMING_CASE, which is a constant rather than a sentence.
  'object-properties': { exclude: ['[A-Z_-]+', 'style', 'value'] },
};

const attributesTranslated = tseslint.config({
  files: ['src/**/*.tsx'],
  plugins: { i18next },
  rules: {
    'i18next/no-literal-string': ['error', attributeRuleOptions],
  },
});

/**
 * One screen, one more exclusion: the password policy's field names.
 *
 * `{num('min_length', t('settings.minLength'))}` puts `min_length` in the JSX,
 * beside the label that names it, and the rule reads it as a sentence. `words`
 * already excludes `[A-Z_-]+` - a constant rather than prose - and this is its
 * lowercase twin; the plugin anchors both ends, so it matches a token that is a
 * field key rather than a phrase that contains one.
 *
 * Kept to the one screen that needs it rather than added to the block above: a
 * word-shape exclusion applies to every literal the rule sees, and a label is
 * only safe from it while nobody writes one in snake_case. The plugin's own
 * defaults are spread rather than re-listed, because naming the option replaces
 * them - and a copy of them here would stop being the plugin's on its next
 * release.
 */
/**
 * One screen, two predicates: the routes list asks whether a column is shown
 * and whether the account may write the resource.
 *
 * `{isVisible('update_time') && <Table.Th>...}` puts an identifier in the JSX,
 * where the rule reads it as a sentence. Excluding a callee hides every
 * argument it is given, which is why this is safe for these two and not in
 * general: they take an identifier and nothing else, while the settings page's
 * `num(key, label)` carries a label that has to stay checked.
 *
 * Kept to the screen that has them, like the exclusion below, so that a helper
 * of the same name written on another screen does not inherit the exemption.
 */
const listPredicatesAreNotProse = tseslint.config({
  files: ['src/routes/routes/index.tsx'],
  plugins: { i18next },
  rules: {
    'i18next/no-literal-string': [
      'error',
      {
        ...attributeRuleOptions,
        callees: {
          exclude: [
            ...i18nextDefaults.callees.exclude,
            'isVisible',
            'canWriteResource',
          ],
        },
      },
    ],
  },
});

const fieldKeysAreNotProse = tseslint.config({
  files: ['src/routes/settings/**/*.tsx'],
  plugins: { i18next },
  rules: {
    'i18next/no-literal-string': [
      'error',
      {
        ...attributeRuleOptions,
        words: {
          exclude: [
            ...i18nextDefaults.words.exclude,
            '[a-z][a-z0-9]*(_[a-z0-9]+)+',
          ],
        },
      },
    ],
  },
});

// One object for every block that names it: ESLint refuses a plugin defined
// twice under one name.
const local = {
  rules: { 'interpolation-data': interpolationData, 'no-prose-literal': noProseLiteral },
};

/**
 * A sentence outside JSX has a key too: see eslint-rules/no-prose-literal.ts.
 *
 * Not in the tests, whose sentences are what they feed the code. And not in
 * the plugin catalogue - two tables of about a hundred names and
 * descriptions each, shown in the plugin picker in English in every language:
 * that is two hundred sentences to translate four times, and its own change.
 */
const proseHasAKey = tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  ignores: [
    'src/**/*.test.{ts,tsx}',
    'src/components/form-slice/FormItemPlugins/pluginTemplates.ts',
    'src/components/form-slice/FormItemPlugins/pluginMetadata.ts',
  ],
  plugins: { local },
  rules: { 'local/no-prose-literal': 'error' },
});

const i18nRules = tseslint.config({
  files: ['src/**/*.{ts,tsx,js}'],
  plugins: {
    i18next: i18next,
    i18n: i18n,
    local,
  },
  rules: {
    ...i18next.configs['flat/recommended'].rules,
    'i18n/no-unknown-key': 'error',
    'i18n/no-text-as-children': ['error', { ignorePattern: '^\\s?[/.]\\s?$' }],
    'i18n/no-text-as-attribute': ['error', { attributes: ['alt', 'title'] }],
    // Not the plugin's i18n/interpolation-data: that one reads the values
    // under a `data` option, which i18next calls do not have, so it either
    // saw nothing (its pattern matched nothing) or reported every call that
    // did pass its values (#326). See eslint-rules/interpolation-data.ts; it
    // reads the catalogue from the `settings.i18n` block below, like the
    // plugin's own rules.
    'local/interpolation-data': 'error',
  },
  settings: {
    i18n: {
      principalLangs: [
        {
          name: 'en',
          translationPath: 'src/locales/en/common.json',
        },
      ],
      functionName: 't',
    },
  },
});

const srcRules = tseslint.config({
  extends: [commonRules],
  files: ['src/**/*.{ts,tsx}', 'eslint.config.ts', 'eslint-rules/**/*.ts'],
  languageOptions: {
    ecmaVersion: 2020,
    globals: globals.browser,
    sourceType: 'module',
  },
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
    react: react,
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    ...react.configs.flat.recommended.rules,
    ...react.configs.flat['jsx-runtime'].rules,
    ...reactHooks.configs.recommended.rules,
    'no-console': 'warn',
    // Translations are interpolated unescaped (src/config/i18n.ts), which is
    // safe exactly while every one of them reaches the screen through React.
    // A gateway's error message, an operator's instance name and a backend's
    // request path all pass through a translation now, so a single
    // dangerouslySetInnerHTML would turn one of them into markup. The comment
    // in i18n.ts says this rule is what holds it (#341).
    'react/no-danger': 'error',
    // i18n/no-unknown-key reads the options of a t() call by name, and a
    // spread has none: before the patch in patches/ it crashed on one, taking
    // the whole lint run with it (#343). Patched, it walks past instead - so
    // the options inside a spread are simply never checked. Written out, they
    // are.
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.name='t'] > ObjectExpression > SpreadElement",
        message:
          'i18n/no-unknown-key cannot see options behind a spread (#343) - write them out.',
      },
      // antd names no row checkbox, and the header's in English whatever
      // the language (#372). The hook hands a table its selection with both
      // named, and its row key with it, as props to spread; a rowSelection
      // that reaches a table any other way - written out on it, built above
      // it, behind a condition - has neither.
      {
        selector: "JSXAttribute[name.name='rowSelection']",
        message:
          'A rowSelection given to a table by hand has checkboxes with no name (#372) - spread the tableProps of useTableRowSelection.',
      },
      {
        // Built, not read: `const rowSelection = tableProps.rowSelection`
        // is the hook's own.
        selector:
          ":matches(ObjectExpression > Property[key.name='rowSelection'], ObjectExpression > Property[key.value='rowSelection'], VariableDeclarator[id.name='rowSelection']) > :matches(ObjectExpression, ConditionalExpression)",
        message:
          'A rowSelection built by hand has checkboxes with no name (#372) - spread the tableProps of useTableRowSelection.',
      },
      // The selection is a list of row keys: a table keyed otherwise than it
      // selects by ticks nothing, or deletes something else.
      {
        selector:
          "JSXOpeningElement:has(> JSXSpreadAttribute[argument.name='tableProps']) > JSXAttribute[name.name='rowKey']",
        message:
          'tableProps holds the rowKey the selection goes by - a rowKey beside it replaces it or is replaced.',
      },
    ],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    'react/jsx-curly-brace-presence': [
      'error',
      {
        props: 'never',
        children: 'never',
      },
    ],
    'react/no-unescaped-entities': [
      'error',
      {
        forbid: ['>', '}'],
      },
    ],
    'react/no-children-prop': [
      'error',
      {
        allowFunctions: true,
      },
    ],
    'react/self-closing-comp': [
      'error',
      {
        component: true,
        html: true,
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ['dist', 'src/routeTree.gen.ts'] },
  e2eRules,
  i18nRules,
  attributesTranslated,
  listPredicatesAreNotProse,
  fieldKeysAreNotProse,
  proseHasAKey,
  srcRules
);
