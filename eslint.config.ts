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

import { ATTRIBUTES_GUARDED } from './src/config/translated-screens';

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
  }
);

/**
 * The screens whose attributes are held to i18n as well as their text.
 *
 * i18next/no-literal-string runs in its jsx-text-only mode everywhere, which
 * never looks at an attribute, and i18n/no-text-as-attribute covers alt and
 * title alone - which is how thirteen strings came to be written in English on
 * the Users page (#320) and how the next label would be (#328).
 *
 * A list that grows: turning it on everywhere reports 59 occurrences today, so
 * each screen joins this once its own strings have keys, and cannot slip back.
 * The count is worth re-measuring rather than trusting - 97 when #328 was
 * written, 69 with the header and instances done - and every screen that joins
 * takes its own share out of it. The list itself lives beside the one the
 * translation check reads, in src/config/translated-screens.ts.
 *
 * It holds attributes, not the whole screen: a string in a `notifications.show`
 * object has no JSX ancestor, so this mode never sees it (thirteen of them sat
 * on the instances page). A screen is done when its keys exist, not when this
 * rule is quiet.
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
  files: ATTRIBUTES_GUARDED,
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

const i18nRules = tseslint.config({
  files: ['src/**/*.{ts,tsx,js}'],
  plugins: {
    i18next: i18next,
    i18n: i18n,
  },
  rules: {
    ...i18next.configs['flat/recommended'].rules,
    'i18n/no-unknown-key': 'error',
    'i18n/no-text-as-children': ['error', { ignorePattern: '^\\s?[/.]\\s?$' }],
    'i18n/no-text-as-attribute': ['error', { attributes: ['alt', 'title'] }],
    'i18n/interpolation-data': [
      'error',
      { interpolationPattern: '\\{\\.+\\}' },
    ],
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
  files: ['src/**/*.{ts,tsx}', 'eslint.config.ts'],
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
  fieldKeysAreNotProse,
  srcRules
);
