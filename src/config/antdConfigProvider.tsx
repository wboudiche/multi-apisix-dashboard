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

import { useComputedColorScheme } from '@mantine/core';
import { ConfigProvider, theme as antdTheme } from 'antd';
import enUS from 'antd/locale/en_US';
import type { PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

export const AntdConfigProvider = (props: PropsWithChildren) => {
  const { children } = props;
  const { t } = useTranslation();
  // The tables follow the scheme Mantine resolved, the system's included.
  const dark = useComputedColorScheme('light') === 'dark';

  return (
    <ConfigProvider
      virtual
      locale={enUS}
      renderEmpty={() => <div>{t('noData')}</div>}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          borderRadiusSM: 2,
          // On the cards of the dark scheme (global.css), not antd's black.
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
      {children}
    </ConfigProvider>
  );
};
