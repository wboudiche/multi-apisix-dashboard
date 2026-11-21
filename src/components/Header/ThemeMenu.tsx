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
import { ActionIcon, type MantineColorScheme, Menu, useMantineColorScheme } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import IconSystem from '~icons/material-symbols/brightness-auto';
import IconCheck from '~icons/material-symbols/check';
import IconDark from '~icons/material-symbols/dark-mode';
import IconLight from '~icons/material-symbols/light-mode';

const ICONS: Record<MantineColorScheme, typeof IconLight> = {
  light: IconLight,
  dark: IconDark,
  auto: IconSystem,
};

/**
 * Light, dark, or as the operating system says: kept in this browser by
 * Mantine (localStorage `mantine-color-scheme-value`), and read back before
 * the first paint by the script in index.html.
 */
export const ThemeMenu = () => {
  const { t } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const Icon = ICONS[colorScheme];
  const options = [
    { value: 'light', label: t('header.themeLight') },
    { value: 'dark', label: t('header.themeDark') },
    { value: 'auto', label: t('header.themeSystem') },
  ] satisfies { value: MantineColorScheme; label: string }[];

  return (
    <Menu shadow="md" width={200}>
      <Menu.Target>
        <ActionIcon variant="light" size="sm" aria-label={t('header.theme')}>
          <Icon />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {options.map(({ value, label }) => {
          const ItemIcon = ICONS[value];
          const chosen = value === colorScheme;
          return (
            <Menu.Item
              key={value}
              leftSection={<ItemIcon width={16} height={16} />}
              rightSection={chosen ? <IconCheck width={16} height={16} /> : undefined}
              // Mantine gives every item the menuitem role: the one in use
              // is told by aria-current, not by a radio's checked state.
              aria-current={chosen || undefined}
              onClick={() => setColorScheme(value)}
            >
              {label}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
};
