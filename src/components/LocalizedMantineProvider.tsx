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
import { MantineProvider, type MantineThemeOverride, mergeThemeOverrides } from '@mantine/core';
import { type PropsWithChildren, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The theme, with what it says in the page's language: a notification's
 * close button is an icon alone, and read to a screen reader as a button
 * with no name until given one.
 *
 * As a default prop, it is replaced whole by a notification that passes
 * closeButtonProps of its own: one that does must carry the aria-label too.
 */
export const LocalizedMantineProvider = ({
  theme,
  children,
}: PropsWithChildren<{ theme: MantineThemeOverride }>) => {
  const { t, i18n } = useTranslation();
  const localized = useMemo(
    () =>
      mergeThemeOverrides(theme, {
        components: {
          Notification: { defaultProps: { closeButtonProps: { 'aria-label': t('form.btn.close') } } },
        },
      }),
    // The language, for t's answer to change with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, t, i18n.language]
  );
  // As the operating system says until the user picks light or dark.
  return (
    <MantineProvider theme={localized} defaultColorScheme="auto">
      {children}
    </MantineProvider>
  );
};
