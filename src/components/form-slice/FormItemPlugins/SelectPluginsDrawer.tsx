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
import {
  Badge,
  Button,
  Drawer,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  PluginCard,
} from './PluginCard';
import {
  type PluginCardListProps,
  PluginCardListSearch,
} from './PluginCardList';
import {
  CATEGORY_COLORS,
  CATEGORY_ORDER,
  groupPluginsByCategory,
  type PluginCategory,
} from './pluginMetadata';

export type SelectPluginsDrawerProps = Pick<PluginCardListProps, 'plugins'> & {
    onAdd: (name: string) => void;
    opened: boolean;
    setOpened: (open: boolean) => void;
    disabled?: boolean;
  };
/**
 * because we need keep the drawer order when using the Drawer.Stack, so we pass disabled to the btn
 */
export const SelectPluginsDrawer = (props: SelectPluginsDrawerProps) => {
  const { plugins, onAdd, opened, setOpened, disabled = false } = props;
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const filteredPlugins = useMemo(() => {
    if (!search) return plugins;
    const lower = search.toLowerCase().trim();
    return plugins.filter((p) => p.toLowerCase().includes(lower));
  }, [plugins, search]);

  const groupedPlugins = useMemo(
    () => groupPluginsByCategory(filteredPlugins),
    [filteredPlugins]
  );

  return (
    <>
      <Drawer
        offset={0}
        radius="md"
        position="right"
        size="xl"
        closeOnEscape={false}
        opened={opened}
        onClose={() => setOpened(false)}
        title={t('form.plugins.selectPlugins.title')}
      >
        <Drawer.Header p={0} mih="60px">
          <PluginCardListSearch search={search} setSearch={setSearch} />
        </Drawer.Header>

        <ScrollArea.Autosize h="80vh" type="scroll">
          <Stack gap="md">
            {CATEGORY_ORDER.map((cat: PluginCategory) => {
              const catPlugins = groupedPlugins[cat];
              if (!catPlugins || catPlugins.length === 0) return null;
              return (
                <Stack key={cat} gap="xs">
                  <Group gap={6}>
                    <Badge size="sm" variant="light" color={CATEGORY_COLORS[cat]}>
                      {t(`form.plugins.category.${cat}`)}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {catPlugins.length}
                    </Text>
                  </Group>
                  <SimpleGrid cols={2}>
                    {catPlugins.map((name) => (
                      <PluginCard
                        key={name}
                        mode="add"
                        name={name}
                        onAdd={() => onAdd(name)}
                      />
                    ))}
                  </SimpleGrid>
                </Stack>
              );
            })}
            {filteredPlugins.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                {t('noData')}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Drawer>
      {!disabled && (
        <Button ml={8} onClick={() => setOpened(true)}>
          {t('form.plugins.selectPlugins.title')}
        </Button>
      )}
    </>
  );
};
