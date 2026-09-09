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
  Box,
  Button,
  Grid,
  Group,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelFilter } from '@/components/page/LabelFilter';
import IconArrowDropDown from '~icons/material-symbols/arrow-drop-down';
import IconArrowDropUp from '~icons/material-symbols/arrow-drop-up';

export type FilterOption = { value: string; label: string };

/**
 * What the bar hands back when Search is pressed.
 *
 * The repeatable filters are read back as a bare string when the URL holds only
 * one — which is what an older bookmark holds — and `status` comes back as a
 * number, because the router parses `?status=1` for us. Both are normalised at
 * the point of use rather than assumed away.
 */
export type RouteFilters = {
  name?: string;
  uri?: string;
  status?: string | number;
  team_id?: string | string[];
  label?: string | string[];
  upstream_id?: string | string[];
  page?: number;
};

/** A repeatable filter, whatever shape the URL delivered it in. */
const asList = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};

type RoutesFilterBarProps = {
  /** The filters currently in the URL, so the bar reopens showing them. */
  params: RouteFilters;
  onSearch: (filters: RouteFilters) => void;
  onReset: () => void;
  /** Only an admin sees more than one team, so only an admin can narrow by it. */
  isAdmin: boolean;
  teamOptions: FilterOption[];
  upstreamOptions: FilterOption[];
};

const LABEL_WIDTH = 80;

const TextFilter: FC<{
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, placeholder, value, onChange }) => (
  <Group gap="xs" style={{ minWidth: 250 }} wrap="nowrap">
    <Text size="sm" fw={500} style={{ width: LABEL_WIDTH, textAlign: 'right', flexShrink: 0 }}>
      {label}:
    </Text>
    <TextInput
      placeholder={placeholder}
      size="sm"
      style={{ flex: 1 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </Group>
);

export const RoutesFilterBar: FC<RoutesFilterBarProps> = ({
  params,
  onSearch,
  onReset,
  isAdmin,
  teamOptions,
  upstreamOptions,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<RouteFilters>(params);

  // The URL is the source of truth: a back button or a shared link has to be
  // reflected in the fields rather than silently ignored.
  //
  // Adjusted during render rather than in an effect. An effect here would set
  // state synchronously and cascade a render on every params change — the same
  // finding that #86 was raised for. Remounting on a key would work too, but it
  // would also reset `expanded` and collapse the bar after every search.
  const paramsKey = JSON.stringify(params);
  const [lastParamsKey, setLastParamsKey] = useState(paramsKey);
  if (paramsKey !== lastParamsKey) {
    setLastParamsKey(paramsKey);
    setDraft(params);
  }

  const set = <K extends keyof RouteFilters>(key: K, value: RouteFilters[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // Back to the first page: a narrowing search run from page 3 used to keep
  // page 3, land past the end of the shorter result and show an empty table
  // under a pager that reported matches.
  const search = () => onSearch({ ...draft, page: 1 });
  const reset = () => {
    setDraft({});
    onReset();
  };

  const nameFilter = (
    <TextFilter
      label={t('routes.list.filterName')}
      placeholder={t('routes.list.filterPlaceholder')}
      value={draft.name ?? ''}
      onChange={(v) => set('name', v)}
    />
  );
  const pathFilter = (
    <TextFilter
      label={t('routes.list.filterPath')}
      placeholder={t('routes.list.filterPlaceholder')}
      value={draft.uri ?? ''}
      onChange={(v) => set('uri', v)}
    />
  );
  const statusFilter = (
    <Group gap="xs" style={{ minWidth: 250 }} wrap="nowrap">
      <Text size="sm" fw={500} style={{ width: LABEL_WIDTH, textAlign: 'right', flexShrink: 0 }}>
        {t('routes.list.filterStatus')}:
      </Text>
      <Select
        data={[
          { label: t('routes.list.statusPublished'), value: '1' },
          { label: t('routes.list.statusUnpublished'), value: '0' },
        ]}
        placeholder={t('routes.list.filterStatusPlaceholder')}
        size="sm"
        style={{ flex: 1 }}
        clearable
        value={draft.status != null ? String(draft.status) : null}
        onChange={(v) => set('status', v ?? undefined)}
      />
    </Group>
  );

  const actions = (
    <Group gap="sm">
      <Button variant="default" size="sm" onClick={reset}>
        {t('routes.list.filterReset')}
      </Button>
      <Button color="blue" variant="filled" size="sm" onClick={search}>
        {t('routes.list.filterSearch')}
      </Button>
      <Button
        variant="transparent"
        size="sm"
        onClick={() => setExpanded((v) => !v)}
        rightSection={
          expanded ? (
            <IconArrowDropUp width="14" height="14" />
          ) : (
            <IconArrowDropDown width="14" height="14" />
          )
        }
        style={{ color: '#1890ff', fontWeight: 400 }}
      >
        {expanded ? t('routes.list.filterCollapse') : t('routes.list.filterExpand')}
      </Button>
    </Group>
  );

  return (
    <Paper p="md" mb="md" radius="sm" shadow="sm" w="100%" style={{ border: '1px solid #eee' }}>
      <Stack gap="md">
        {!expanded ? (
          <Group justify="space-between" align="center">
            <Group gap="xl" flex={1}>
              {nameFilter}
              {pathFilter}
              {statusFilter}
            </Group>
            {actions}
          </Group>
        ) : (
          <Grid gutter="lg" align="flex-start">
            <Grid.Col span={4}>{nameFilter}</Grid.Col>
            <Grid.Col span={4}>{pathFilter}</Grid.Col>
            <Grid.Col span={4}>{statusFilter}</Grid.Col>

            <Grid.Col span={4}>
              {/* Given its own frame because it is the one an operator reaches
                  for during an incident: the question is which routes touch the
                  gateway that is failing. */}
              <Box
                p="xs"
                style={{
                  border: '1px solid var(--mantine-color-blue-4)',
                  background: 'var(--mantine-color-blue-0)',
                  borderRadius: 'var(--mantine-radius-sm)',
                }}
              >
                <Group gap={6} mb={6} wrap="nowrap">
                  <Text size="sm" fw={600}>{t('routes.list.filterUpstream')}</Text>
                  <Text size="xs" c="dimmed">{t('routes.list.filterMultiHint')}</Text>
                </Group>
                <MultiSelect
                  data={upstreamOptions}
                  placeholder={t('routes.list.filterUpstreamPlaceholder')}
                  size="sm"
                  searchable
                  clearable
                  nothingFoundMessage={t('routes.list.filterUpstreamEmpty')}
                  value={asList(draft.upstream_id)}
                  onChange={(v) => set('upstream_id', v.length > 0 ? v : undefined)}
                />
              </Box>
            </Grid.Col>

            {isAdmin && (
              <Grid.Col span={4}>
                <Group gap={6} mb={6} wrap="nowrap">
                  <Text size="sm" fw={500}>{t('routes.list.filterTeam')}</Text>
                  <Text size="xs" c="dimmed">{t('routes.list.filterMultiHint')}</Text>
                </Group>
                <MultiSelect
                  data={teamOptions}
                  placeholder={t('routes.list.filterTeamPlaceholder')}
                  size="sm"
                  searchable
                  clearable
                  value={asList(draft.team_id)}
                  onChange={(v) => set('team_id', v.length > 0 ? v : undefined)}
                />
              </Grid.Col>
            )}

            <Grid.Col span={isAdmin ? 4 : 8}>
              <Group gap={6} mb={6} wrap="nowrap">
                <Text size="sm" fw={500}>{t('routes.list.filterLabels')}</Text>
                <Text size="xs" c="dimmed">{t('routes.list.filterMultiHint')}</Text>
              </Group>
              <LabelFilter
                value={asList(draft.label)}
                onChange={(v) => set('label', v.length > 0 ? v : undefined)}
              />
            </Grid.Col>

            <Grid.Col span={12}>
              <Group justify="flex-end">{actions}</Group>
            </Grid.Col>
          </Grid>
        )}
      </Stack>
    </Paper>
  );
};
