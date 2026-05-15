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
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  Grid,
  Group,
  Loader,
  Menu,
  Pagination,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteListQueryOptions, useRouteList } from '@/apis/hooks';
import { teamApi } from '@/apis/teams';
import { RouteLinkBtn } from '@/components/Btn';
import { BatchDeleteBtn } from '@/components/page/BatchDeleteBtn';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import { ImportRoutesModal } from '@/components/page/ImportRoutesModal';
import { LabelFilter } from '@/components/page/LabelFilter';
import { RawJsonDrawer } from '@/components/page/RawJsonDrawer';
import { RouteTestDrawer } from '@/components/page/RouteTestDrawer';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { API_ROUTES } from '@/config/constant';
import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { downloadOpenAPI, routesToOpenAPI } from '@/utils/openapi-export';
import { useSearchParams } from '@/utils/useSearchParams';
import type { ListPageKeys } from '@/utils/useTablePagination';
import IconArrowDropDown from '~icons/material-symbols/arrow-drop-down';
import IconArrowDropUp from '~icons/material-symbols/arrow-drop-up';
import IconCode from '~icons/material-symbols/code';
import IconCopy from '~icons/material-symbols/content-copy-outline';
import IconDelete from '~icons/material-symbols/delete-outline';
import IconExport from '~icons/material-symbols/download';
import IconPlayArrow from '~icons/material-symbols/play-arrow';
import IconRefresh from '~icons/material-symbols/refresh';
import IconSettings from '~icons/material-symbols/settings-outline';
import IconUpload from '~icons/material-symbols/upload';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type RouteListProps = {
  routeKey: Extract<ListPageKeys, '/routes/' | '/services/detail/$id/routes/'>;
  data: any;
  isLoading: boolean;
  refetch: () => void;
  setParams: (params: any) => void;
  visibleColumns: string[];
  defaultParams?: Record<string, any>;
  ToDetailBtn?: React.ComponentType<{ record: any }>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const RouteList = (props: RouteListProps) => {
  const { routeKey, data, isLoading, refetch, setParams, visibleColumns } = props;
  const { params: rawParams } = useSearchParams(routeKey);
  const params = rawParams as { page?: number; page_size?: number };
  const { t } = useTranslation();
  const { canEdit, canDelete } = usePermission();
  const [jsonDrawerOpen, setJsonDrawerOpen] = useState(false);
  const [jsonDrawerData, setJsonDrawerData] = useState<{ id: string; json: Record<string, unknown> } | null>(null);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testDrawerRoute, setTestDrawerRoute] = useState<{ path: string; method: string; host?: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamApi.list(),
    staleTime: 60_000,
  });
  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    teams?.forEach((tm) => map.set(tm.id, tm.name));
    return map;
  }, [teams]);

  const allIds: string[] = data?.list?.map((r: { value: { id: string } }) => r.value.id) || [];
  const allSelected = allIds.length > 0 && allIds.every((id: string) => selectedIds.has(id));
  const someSelected = allIds.some((id: string) => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const handleExportOpenAPI = (routes: Record<string, unknown>[]) => {
    const spec = routesToOpenAPI(routes);
    downloadOpenAPI(spec);
  };

  const handleExportSelected = () => {
    const selected = data?.list
      ?.filter((r: { value: { id: string } }) => selectedIds.has(r.value.id))
      .map((r: { value: Record<string, unknown> }) => r.value) || [];
    if (selected.length > 0) handleExportOpenAPI(selected);
  };

  const handleTestRoute = (record: Record<string, unknown>) => {
    const uri = (record.uri as string) || (record.uris as string[])?.[0] || '/';
    const method = (record.methods as string[])?.[0] || 'GET';
    const host = (record.host as string) || (record.hosts as string[])?.[0] || undefined;
    setTestDrawerRoute({ path: uri, method, host });
    setTestDrawerOpen(true);
  };

  const handleViewJson = (record: Record<string, unknown>) => {
    setJsonDrawerData({ id: record.id as string, json: record });
    setJsonDrawerOpen(true);
  };

  const handleJsonSave = useCallback(async (jsonData: Record<string, unknown>) => {
    if (!jsonDrawerData) return;
    setJsonSaving(true);
    try {
      const body = { ...jsonData };
      delete body.id;
      delete body.create_time;
      delete body.update_time;
      await req.put(`${API_ROUTES}/${jsonDrawerData.id}`, body);
      notifications.show({
        message: t('form.json.saveSuccess'),
        color: 'green',
      });
      refetch();
      setJsonDrawerOpen(false);
    } finally {
      setJsonSaving(false);
    }
  }, [jsonDrawerData, t, refetch]);

  const navigate = useNavigate();
  const handleDuplicate = useCallback(async (record: Record<string, unknown>) => {
    try {
      const body = { ...record };
      delete body.id;
      delete body.create_time;
      delete body.update_time;
      body.name = `${record.name || ''} (copy)`;
      const res = await req.post(API_ROUTES, body);
      const newId = res.data?.value?.id;
      if (newId) {
        await navigate({ to: '/routes/detail/$id', params: { id: newId } });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error_msg?: string } }; message?: string };
      notifications.show({
        message: e?.response?.data?.error_msg || e?.message || 'Failed to duplicate',
        color: 'red',
      });
    }
  }, [navigate]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await req.delete(`${API_ROUTES}/${id}`);
      notifications.show({
        message: t('info.delete.success', { name: t('routes.singular') }),
        color: 'green',
      });
      refetch();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error_msg?: string } }; message?: string };
      notifications.show({
        message: e?.response?.data?.error_msg || e?.message || 'Failed to delete',
        color: 'red',
      });
    }
  }, [t, refetch]);

  const isVisible = (col: string) => visibleColumns.includes(col);

  if (isLoading && !data?.list) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Paper className="Card-root" p={0}>
      {someSelected && (
        <Group justify="space-between" px="lg" py="xs" style={{ background: 'var(--mantine-color-blue-0, #e7f5ff)', borderBottom: '1px solid #eee' }}>
          <Text size="sm" fw={500}>{t('form.json.selectedCount', { count: selectedIds.size })}</Text>
          <Group gap="xs">
            <BatchDeleteBtn
              ids={Array.from(selectedIds)}
              apiBase={API_ROUTES}
              resourceName={t('routes.singular')}
              onSuccess={refetch}
              onClearSelection={() => setSelectedIds(new Set())}
            />
            <Button
              size="compact-sm"
              variant="light"
              leftSection={<IconExport width="14" height="14" />}
              onClick={handleExportSelected}
            >
              {t('form.json.exportOpenAPI')}
            </Button>
          </Group>
        </Group>
      )}
      <Table horizontalSpacing="lg" verticalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 40 }}><Checkbox aria-label="Select all" checked={allSelected} indeterminate={someSelected && !allSelected} onChange={toggleSelectAll} /></Table.Th>
            {isVisible('name') && <Table.Th>{t('form.basic.name')}</Table.Th>}
            {isVisible('id') && <Table.Th>ID</Table.Th>}
            {isVisible('host') && <Table.Th>{t('routes.list.headerHost')}</Table.Th>}
            {isVisible('path') && <Table.Th>{t('routes.list.headerPath')}</Table.Th>}
            {isVisible('desc') && <Table.Th>{t('routes.list.headerDescription')}</Table.Th>}
            {isVisible('label') && <Table.Th>{t('routes.list.headerLabels')}</Table.Th>}
            {isVisible('version') && <Table.Th>{t('routes.list.headerVersion')}</Table.Th>}
            {isVisible('status') && <Table.Th>{t('routes.list.headerStatus')}</Table.Th>}
            {isVisible('update_time') && <Table.Th>{t('routes.list.headerUpdateTime')}</Table.Th>}
            {isVisible('plugin') && <Table.Th>{t('routes.list.headerPlugin')}</Table.Th>}
            {isVisible('team') && <Table.Th>{t('sources.teams')}</Table.Th>}
            {isVisible('operation') && <Table.Th style={{ width: 1, whiteSpace: 'nowrap' }}>{t('routes.list.headerOperation')}</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {data?.list.map((record: any, index: number) => (
            <Table.Tr key={record.value.id} className={`stagger-${(index % 5) + 1}`}>
              <Table.Td>
                <Checkbox aria-label="Select row" checked={selectedIds.has(record.value.id)} onChange={() => toggleSelect(record.value.id)} />
              </Table.Td>
              {isVisible('name') && (
                <Table.Td>
                  <Text fw={600} size="sm">
                    {record.value.name || '-'}
                  </Text>
                </Table.Td>
              )}
              {isVisible('id') && (
                <Table.Td>
                  <Text size="xs" ff="monospace" c="dimmed">
                    {record.value.id}
                  </Text>
                </Table.Td>
              )}
              {isVisible('host') && (
                <Table.Td>
                  {record.value.host ? (
                    <Text size="sm">{record.value.host}</Text>
                  ) : record.value.hosts && record.value.hosts.length > 0 ? (
                    <Text size="sm">{record.value.hosts.join(', ')}</Text>
                  ) : (
                    <Text size="sm" c="dimmed">-</Text>
                  )}
                </Table.Td>
              )}
              {isVisible('path') && (
                <Table.Td>
                  {record.value.uri ? (
                    <Badge variant="light" color="blue" radius="sm" ff="monospace">
                      {record.value.uri}
                    </Badge>
                  ) : record.value.uris && record.value.uris.length > 0 ? (
                    <Group gap={4}>
                      {record.value.uris.map((uri: string, i: number) => (
                        <Badge key={i} variant="light" color="blue" radius="sm" ff="monospace">
                          {uri}
                        </Badge>
                      ))}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">-</Text>
                  )}
                </Table.Td>
              )}
              {isVisible('desc') && (
                <Table.Td>
                  <Text size="xs" c="dimmed" style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {record.value.desc || '-'}
                  </Text>
                </Table.Td>
              )}
              {isVisible('label') && (
                <Table.Td>
                  {record.value.labels && Object.keys(record.value.labels).length > 0 ? (
                    <Group gap={4}>
                      {Object.entries(record.value.labels).map(([key, value]) => (
                        <Badge key={key} variant="dot" size="sm" color="gray">
                          {key}:{value as string}
                        </Badge>
                      ))}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">-</Text>
                  )}
                </Table.Td>
              )}
              {isVisible('version') && (
                <Table.Td>
                  <Text size="sm" c="dimmed">-</Text>
                </Table.Td>
              )}
              {isVisible('status') && (
                <Table.Td>
                  {record.value.status === 1 ? (
                    <Badge color="green" variant="outline" size="sm">{t('routes.list.statusPublished')}</Badge>
                  ) : (
                    <Badge color="gray" variant="outline" size="sm">{t('routes.list.statusUnpublished')}</Badge>
                  )}
                </Table.Td>
              )}
              {isVisible('update_time') && (
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {record.value.update_time ? new Date(record.value.update_time * 1000).toLocaleString() : '-'}
                  </Text>
                </Table.Td>
              )}
              {isVisible('plugin') && (
                <Table.Td>
                  {record.value.plugins && Object.keys(record.value.plugins).length > 0 ? (
                    <Group gap={4}>
                      {Object.keys(record.value.plugins).map((pluginName) => (
                        <Badge key={pluginName} variant="light" size="sm" color="blue">
                          {pluginName}
                        </Badge>
                      ))}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">-</Text>
                  )}
                </Table.Td>
              )}
              {isVisible('team') && (
                <Table.Td>
                  {record.value.__team_id ? (
                    <Badge variant="light" color="teal" size="sm">
                      {teamMap.get(record.value.__team_id) || record.value.__team_id}
                    </Badge>
                  ) : (
                    <Text size="xs" c="dimmed" fs="italic">{t('noData')}</Text>
                  )}
                </Table.Td>
              )}
              {isVisible('operation') && (
                <Table.Td>
                  <Group gap={8} wrap="nowrap">
                    <DeleteResourceBtn
                      name={t('routes.singular')}
                      target={record.value.id}
                      api={`${API_ROUTES}/${record.value.id}`}
                      onSuccess={refetch}
                      mode="list"
                      size="xs"
                      color="red"
                      variant="filled"
                      radius="sm"
                      styles={{ root: { padding: '0 12px' } }}
                    >
                      {t('routes.list.actionOffline')}
                    </DeleteResourceBtn>
                    <RouteLinkBtn
                      to="/routes/detail/$id"
                      params={{ id: record.value.id }}
                      size="xs"
                      color="blue"
                      variant="filled"
                      radius="sm"
                      styles={{ root: { padding: '0 12px' } }}
                    >
                      {t('routes.list.actionConfigure')}
                    </RouteLinkBtn>
                    <Menu shadow="md" width={160}>
                      <Menu.Target>
                        <Button size="xs" variant="default" radius="sm" rightSection={<IconArrowDropDown width="14" height="14" />}>{t('routes.list.actionMore')}</Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconPlayArrow width="14" height="14" />}
                          onClick={() => handleTestRoute(record.value)}
                        >
                          {t('form.routeTest.title')}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconCode width="14" height="14" />}
                          onClick={() => handleViewJson(record.value)}
                        >
                          {t('form.json.viewRaw')}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconExport width="14" height="14" />}
                          onClick={() => handleExportOpenAPI([record.value])}
                        >
                          {t('form.json.exportOpenAPI')}
                        </Menu.Item>
                        {canEdit && (
                          <Menu.Item
                            leftSection={<IconCopy width="14" height="14" />}
                            onClick={() => handleDuplicate(record.value)}
                          >
                            {t('form.json.duplicate')}
                          </Menu.Item>
                        )}
                        {canDelete && (<>
                          <Menu.Divider />
                          <Menu.Item
                            leftSection={<IconDelete width="14" height="14" />}
                            color="red"
                            onClick={() => handleDelete(record.value.id)}
                          >
                            {t('form.btn.delete')}
                          </Menu.Item>
                        </>)}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
          {(!data?.list || data.list.length === 0) && (
            <Table.Tr>
              <Table.Td colSpan={visibleColumns.length + 1}>
                <Center py="xl">
                  <Text c="dimmed">{t('noData')}</Text>
                </Center>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Group justify="flex-end" p="md" style={{ borderTop: '1px solid #eee' }}>
        <Pagination
          total={Math.ceil((data?.total || 0) / (params.page_size || 10))}
          value={params.page || 1}
          onChange={(page) => setParams({ page })}
          size="sm"
          radius="sm"
        />
      </Group>

      <RawJsonDrawer
        opened={jsonDrawerOpen}
        onClose={() => setJsonDrawerOpen(false)}
        title={canEdit ? t('form.json.editRaw') : t('form.json.viewRaw')}
        json={jsonDrawerData?.json ?? null}
        onSave={canEdit ? handleJsonSave : undefined}
        loading={jsonSaving}
      />
      <RouteTestDrawer
        opened={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        defaultPath={testDrawerRoute?.path}
        defaultMethod={testDrawerRoute?.method}
        defaultHost={testDrawerRoute?.host}
      />
    </Paper >
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FilterInput = ({ label, placeholder, valueKey, selectData, localParams, setLocalParams }: { label: string; placeholder: string; valueKey: string; selectData?: { label: string; value: string }[]; localParams: any; setLocalParams: (params: any) => void }) => (
  <Group gap="xs" style={{ minWidth: 250 }}>
    <Text size="sm" fw={500} style={{ width: 80, textAlign: 'right' }}>{label}:</Text>
    {selectData ? (
      <Select
        data={selectData}
        placeholder={placeholder}
        size="sm"
        style={{ flex: 1 }}
        value={localParams[valueKey] || null}
        onChange={(val) => setLocalParams({ ...localParams, [valueKey]: val })}
      />
    ) : (
      <TextInput
        placeholder={placeholder}
        size="sm"
        style={{ flex: 1 }}
        value={localParams[valueKey] || ''}
        onChange={(e) => setLocalParams({ ...localParams, [valueKey]: e.target.value })}
      />
    )}
  </Group>
);

function RouteComponent() {
  const { t } = useTranslation();
  const { canEdit } = usePermission();
  const { params, setParams, resetParams } = useSearchParams('/routes/');
  const { data, isLoading, refetch, setParams: setRouteParams } = useRouteList('/routes/');
  const [localParams, setLocalParams] = useState(params);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [appliedLabels, setAppliedLabels] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const filteredData = useMemo(() => {
    if (!data || appliedLabels.length === 0) return data;
    const filtered = data.list?.filter((record: { value?: { labels?: Record<string, string> } }) => {
      const routeLabels = record.value?.labels;
      if (!routeLabels) return false;
      return appliedLabels.every((tag) => {
        const [key, val] = tag.split(':');
        return routeLabels[key] === val;
      });
    }) || [];
    return { ...data, list: filtered, total: filtered.length };
  }, [data, appliedLabels]);

  const ALL_COLUMNS = [
    { label: 'Name', value: 'name' },
    { label: 'ID', value: 'id' },
    { label: 'Host', value: 'host' },
    { label: 'Path', value: 'path' },
    { label: 'Description', value: 'desc' },
    { label: 'Labels', value: 'label' },
    { label: 'Version', value: 'version' },
    { label: 'Status', value: 'status' },
    { label: 'Update Time', value: 'update_time' },
    { label: 'Plugin', value: 'plugin' },
    { label: 'Team', value: 'team' },
  ];

  const DEFAULT_COLUMNS = ['name', 'path', 'label', 'status', 'update_time', 'plugin', 'team', 'operation'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    setLocalParams(params);
  }, [params]);

  return (
    <Box className="animate-fade-in-up" bg="#f0f2f5" style={{ minHeight: '100vh', width: '100%' }}>

      <Paper p="md" mb="md" radius="sm" shadow="sm" w="100%" style={{ border: '1px solid #eee' }}>
        <Stack gap="md">
          {!expanded ? (
            <Group justify="space-between" align="center">
              <Group gap="xl" flex={1}>
                <FilterInput label="Name" placeholder="Please enter" valueKey="name" localParams={localParams} setLocalParams={setLocalParams} />
                <FilterInput label="Path" placeholder="Please enter" valueKey="uri" localParams={localParams} setLocalParams={setLocalParams} />
                <FilterInput label="Status" placeholder="UnPublished/Published" valueKey="status" selectData={[{ label: 'Published', value: '1' }, { label: 'UnPublished', value: '0' }]} localParams={localParams} setLocalParams={setLocalParams} />
              </Group>
              <Group gap="sm">
                <Button variant="default" size="sm" onClick={() => { setLocalParams({}); resetParams(); }}>{t('routes.list.filterReset')}</Button>
                <Button color="blue" variant="filled" size="sm" onClick={() => setParams(localParams)}>{t('routes.list.filterSearch')}</Button>
                <Button variant="transparent" size="sm" onClick={() => setExpanded(true)} rightSection={<IconArrowDropDown width="14" height="14" />} style={{ color: '#1890ff', fontWeight: 400 }}>{t('routes.list.filterExpand')}</Button>
              </Group>
            </Group>
          ) : (
            <Grid gutter="lg" align="flex-start">
              <Grid.Col span={4}><FilterInput label="Name" placeholder="Please enter" valueKey="name" localParams={localParams} setLocalParams={setLocalParams} /></Grid.Col>
              <Grid.Col span={4}><FilterInput label="Path" placeholder="Please enter" valueKey="uri" localParams={localParams} setLocalParams={setLocalParams} /></Grid.Col>
              <Grid.Col span={4}><FilterInput label="Status" placeholder="UnPublished/Published" valueKey="status" selectData={[{ label: 'Published', value: '1' }, { label: 'UnPublished', value: '0' }]} localParams={localParams} setLocalParams={setLocalParams} /></Grid.Col>
              <Grid.Col span={12}>
                <Group gap="xs" align="center" wrap="nowrap">
                  <Text size="sm" fw={500} style={{ width: 80, textAlign: 'right', flexShrink: 0 }}>{t('routes.list.filterLabels')}</Text>
                  <LabelFilter value={selectedLabels} onChange={setSelectedLabels} />
                </Group>
              </Grid.Col>

              <Grid.Col span={12}>
                <Group justify="flex-end" gap="sm">
                  <Button variant="default" size="sm" onClick={() => { setLocalParams({}); setSelectedLabels([]); setAppliedLabels([]); resetParams(); }}>{t('routes.list.filterReset')}</Button>
                  <Button color="blue" variant="filled" size="sm" onClick={() => { setAppliedLabels(selectedLabels); setParams({ ...localParams, label: selectedLabels.length > 0 ? selectedLabels[0].split(':')[0] : undefined }); }}>{t('routes.list.filterSearch')}</Button>
                  <Button variant="transparent" size="sm" onClick={() => setExpanded(false)} rightSection={<IconArrowDropUp width="14" height="14" />} style={{ color: '#1890ff', fontWeight: 400 }}>{t('routes.list.filterCollapse')}</Button>
                </Group>
              </Grid.Col>
            </Grid>
          )}
        </Stack>
      </Paper>

      <Paper p="md" radius="sm" shadow="sm" w="100%" style={{ borderTop: '2px solid #F8423F' }}>
        <Group justify="flex-end" mb="md" align="center">
          <Group gap="sm">
            <ToAddPageBtn
              label={t('form.btn.create')}
              to="/routes/add"
              color="blue"
            />
            {canEdit && (
              <Button
                variant="default"
                size="sm"
                leftSection={<IconUpload width="16" height="16" />}
                onClick={() => setImportModalOpen(true)}
              >
                {t('form.import.title')}
              </Button>
            )}
            <ActionIcon variant="subtle" color="gray" size="md" onClick={() => refetch()}><IconRefresh width="18" height="18" /></ActionIcon>
            <Popover width={200} position="bottom-end" withArrow shadow="md">
              <Popover.Target>
                <ActionIcon variant="subtle" color="gray" size="md"><IconSettings width="18" height="18" /></ActionIcon>
              </Popover.Target>
              <Popover.Dropdown p="xs">
                <Group justify="space-between" mb="xs">
                  <Text size="xs" fw={700}>{t('routes.list.columnsTitle')}</Text>
                  <Anchor size="xs" component="button" onClick={() => setVisibleColumns(DEFAULT_COLUMNS)}>{t('routes.list.columnsReset')}</Anchor>
                </Group>

                <Text size="xs" c="dimmed" mb={4}>{t('routes.list.columnsNotFixed')}</Text>
                <Stack gap={4}>
                  {ALL_COLUMNS.map(col => (
                    <Checkbox
                      key={col.value}
                      size="xs"
                      label={col.label}
                      checked={visibleColumns.includes(col.value)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setVisibleColumns(prev =>
                          checked ? [...prev, col.value] : prev.filter(c => c !== col.value)
                        );
                      }}
                    />
                  ))}
                </Stack>

                <Divider my="xs" />
                <Text size="xs" c="dimmed" mb={4}>{t('routes.list.columnsFixedRight')}</Text>
                <Checkbox
                  size="xs"
                  label="Operation"
                  checked={visibleColumns.includes('operation')}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setVisibleColumns(prev =>
                      checked ? [...prev, 'operation'] : prev.filter(c => c !== 'operation')
                    );
                  }}
                />
              </Popover.Dropdown>
            </Popover>
          </Group>
        </Group>

        <RouteList
          routeKey="/routes/"
          data={filteredData}
          isLoading={isLoading}
          refetch={refetch}
          setParams={setRouteParams}
          visibleColumns={visibleColumns}
        />
      </Paper>

      <ImportRoutesModal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={refetch}
      />
    </Box>
  );
}

export const Route = createFileRoute('/routes/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getRouteListQueryOptions(deps)),
});
