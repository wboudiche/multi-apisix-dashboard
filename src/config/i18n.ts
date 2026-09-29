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
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de_common from '@/locales/de/common.json';
import en_common from '@/locales/en/common.json';
import es_common from '@/locales/es/common.json';
import tr_common from '@/locales/tr/common.json';
import zh_common from '@/locales/zh/common.json'; 

export const resources = {
  en: {
    common: en_common,
  },
  de: {
    common: de_common,
  },
  zh: {
    common: zh_common,
  },
  es: {
    common: es_common,
  },
  tr: {
    common: tr_common,
  },
} as const;

export type Resources = typeof resources;
export const defaultNS: keyof Resources['en'] = 'common';

/**
 * What every i18next instance in this app is initialised with.
 *
 * Exported because the option that matters here is easy to lose: an instance
 * created elsewhere - a test, a prerender - with its own literal options goes
 * back to escaping, and does it silently.
 */
export const i18nOptions = {
  lng: 'en',
  ns: ['common'],
  defaultNS,
  resources,
  fallbackLng: 'en',
  // React escapes what it renders, so i18next escaping it again turns every
  // slash into &#x2F;. It reached the screen three times before this was set
  // here - a branch name (#237), a request path (#320), a gateway's admin URL
  // (#338) - each fixed at the call site that hit it, five copies of the line
  // in all, with nothing to stop the sixth (#341).
  //
  // This is the value react-i18next documents for React, and it holds only
  // while no translation is rendered as HTML. react/no-danger keeps
  // dangerouslySetInnerHTML out of src/, which is the half that matters: a
  // translation reaches the screen through React, which escapes it. <Trans> is
  // the exception worth knowing - it renders <br>, <strong>, <i> and <p> out of
  // the string itself - but it parses the string before interpolating, so a
  // value put into one still cannot become markup.
  interpolation: { escapeValue: false },
};

i18n.use(initReactI18next).init(i18nOptions);

export default i18n;
