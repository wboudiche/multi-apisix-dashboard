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
import '@ant-design/v5-patch-for-react-19';

import {
  deDEIntl,
  enUSIntl,
  esESIntl,
  ProConfigProvider,
  trTRIntl,
  zhCNIntl,
} from '@ant-design/pro-components';
import { useComputedColorScheme } from '@mantine/core';
import { ConfigProvider, theme as antdTheme } from 'antd';
import deDE from 'antd/locale/de_DE';
import enUS from 'antd/locale/en_US';
import esES from 'antd/locale/es_ES';
import trTR from 'antd/locale/tr_TR';
import zhCN from 'antd/locale/zh_CN';
import type { PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * antd's and the pro table's words - pagination, column settings, empty
 * states - in the page's language. The pro table has a language of its own,
 * Chinese unless told: every list's pagination read 第 1-7 条/总共 7 条.
 */
const LOCALES = {
  en: { antd: enUS, pro: enUSIntl },
  de: { antd: deDE, pro: deDEIntl },
  es: { antd: esES, pro: esESIntl },
  tr: { antd: trTR, pro: trTRIntl },
  zh: { antd: zhCN, pro: zhCNIntl },
} as const;

export const AntdConfigProvider = (props: PropsWithChildren) => {
  const { children } = props;
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2);
  const locale = LOCALES[language as keyof typeof LOCALES] ?? LOCALES.en;
  // The tables follow the scheme Mantine resolved, the system's included.
  // Read during the first render, not in an effect: under System on a dark
  // system, the effect's answer came a frame late and every table flashed
  // light before it.
  const dark = useComputedColorScheme('light', { getInitialValueInEffect: false }) === 'dark';

  return (
    <ConfigProvider
      virtual
      locale={locale.antd}
      renderEmpty={() => <div>{t('noData')}</div>}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          borderRadiusSM: 2,
          // On the cards of the dark scheme, not antd's black: --bg-card and
          // --bg-elevated of global.css's dark block, which change with these.
          ...(dark && { colorBgContainer: '#252830', colorBgElevated: '#2C3039' }),
        },
        components: {
          // The resource tables, a step up from antd's 14px with Mantine's
          // sm. The token alone would grow every antd control too, inputs
          // and selects whose heights are drawn for 14px.
          Table: { fontSize: 15 },
        },
      }}
    >
      <ProConfigProvider intl={locale.pro}>{children}</ProConfigProvider>
    </ConfigProvider>
  );
};
