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
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import {
  CATEGORY_COLORS,
  getPluginCategory,
  getPluginDescription,
  summarizePluginConfig,
} from './pluginMetadata';

export type PluginCardProps = {
  name: string;
  mode: 'add' | 'edit' | 'view';
  description?: string;
  config?: object;
  /**
   * The priority this plugin will run at, and whether the route set it (#48).
   * Undefined for a plugin the gateway does not list, whose place in the order
   * nothing here knows.
   */
  priority?: number;
  priorityOverridden?: boolean;
  onAdd?: (name: string) => void;
  onEdit?: (name: string) => void;
  onDelete?: (name: string) => void;
  onView?: (name: string) => void;
};

export const PluginCard = (props: PluginCardProps) => {
  const {
    name,
    mode,
    description,
    config,
    priority,
    priorityOverridden,
    onAdd,
    onEdit,
    onView,
    onDelete,
  } = props;
  const { t } = useTranslation();
  const category = getPluginCategory(name);
  const categoryColor = CATEGORY_COLORS[category];
  const desc = getPluginDescription(name, description);
  const configSummary = config ? summarizePluginConfig(name, config) : '';

  return (
    <Card withBorder radius="md" p="sm" data-testid={`plugin-${name}`}>
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={600} size="sm" truncate>
                {name}
              </Text>
              <Badge
                size="xs"
                variant="light"
                color={categoryColor}
                style={{ flexShrink: 0 }}
              >
                {t(`form.plugins.category.${category}`)}
              </Badge>
              {/* The number that decides what runs before what. Shown on the
                  selected plugins only: in the add drawer it would be the
                  gateway default for a plugin that is not on the route yet,
                  which says nothing about this route (#48). */}
              {priority !== undefined && mode !== 'add' && (
                <Badge
                  size="xs"
                  variant={priorityOverridden ? 'filled' : 'outline'}
                  color={priorityOverridden ? 'blue' : 'gray'}
                  style={{ flexShrink: 0 }}
                  data-testid={`plugin-priority-${name}`}
                >
                  {t(
                    priorityOverridden
                      ? 'form.plugins.priorityCustom'
                      : 'form.plugins.priorityDefault',
                    { priority }
                  )}
                </Badge>
              )}
            </Group>
            {desc && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {desc}
              </Text>
            )}
          </Stack>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {mode === 'add' && (
              <Button
                size="xs"
                variant="light"
                color="blue"
                onClick={() => onAdd?.(name)}
              >
                {t('form.btn.add')}
              </Button>
            )}
            {mode === 'view' && (
              <Button
                size="xs"
                variant="light"
                onClick={() => onView?.(name)}
              >
                {t('form.btn.view')}
              </Button>
            )}
            {mode === 'edit' && (
              <>
                <Button
                  size="xs"
                  variant="light"
                  color="blue"
                  onClick={() => onEdit?.(name)}
                >
                  {t('form.btn.edit')}
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  onClick={() => onDelete?.(name)}
                >
                  {t('form.btn.delete')}
                </Button>
              </>
            )}
          </Group>
        </Group>
        {configSummary && (mode === 'edit' || mode === 'view') && (
          <Text size="xs" ff="monospace" c="dimmed" lineClamp={1}>
            {configSummary}
          </Text>
        )}
      </Stack>
    </Card>
  );
};
