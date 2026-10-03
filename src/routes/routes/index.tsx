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
  Group,
  Loader,
  Menu,
  Pagination,
  Paper,
  Popover,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAtom,useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteListQueryOptions, useRouteList } from '@/apis/hooks';
import { teamsQueryOptions } from '@/apis/queries';
import { RouteAnchor, RouteLinkBtn } from '@/components/Btn';
import { BatchDeleteBtn } from '@/components/page/BatchDeleteBtn';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import { ImportRoutesModal } from '@/components/page/ImportRoutesModal';
import { ImportWsdlModal } from '@/components/page/ImportWsdlModal';
import { ListWarningBanner } from '@/components/page/ListWarningBanner';
import PageHeader from '@/components/page/PageHeader';
import { RawJsonDrawer } from '@/components/page/RawJsonDrawer';
import type { RouteFilters } from '@/components/page/RoutesFilterBar';
import { RoutesFilterBar } from '@/components/page/RoutesFilterBar';
import { RouteTestDrawer } from '@/components/page/RouteTestDrawer';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import { API_ROUTES } from '@/config/constant';
import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { useAllUpstreams } from '@/hooks/useAllUpstreams';
import { usePermission } from '@/hooks/usePermission';
import { useRowSelection } from '@/hooks/useRowSelection';
import { checkboxNames, rowId, rowNameOrId } from '@/hooks/useTableRowSelection';
import { currentUserAtom } from '@/stores/auth';
import { currentInstanceIdAtom } from '@/stores/instance';
import { ownTeamsAtom } from '@/stores/team';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { withoutDashboardFields } from '@/utils/dashboard-fields';
import { downloadOpenAPI, routesToOpenAPI } from '@/utils/openapi-export';
import { ownerOf } from '@/utils/owner';
import { extractSoapAction } from '@/utils/soap-route';
import { isResourceEnabled } from '@/utils/status';
import { proxyFailureText } from '@/utils/team-refusal';
import { useSearchParams } from '@/utils/useSearchParams';
import type { ListPageKeys } from '@/utils/useTablePagination';
import IconArrowDropDown from '~icons/material-symbols/arrow-drop-down';
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
  /** Which list `data` is, as the list hook names it: the selection is kept under it. */
  listKey: string;
  defaultParams?: Record<string, any>;
  ToDetailBtn?: React.ComponentType<{ record: any }>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const RouteList = (props: RouteListProps) => {
  const { routeKey, data, isLoading, refetch, setParams, visibleColumns, listKey } = props;
  const { params: rawParams } = useSearchParams(routeKey);
  const params = rawParams as { page?: number; page_size?: number };
  const { t } = useTranslation();
  const { isAdmin, canWriteResource, canWriteOwner } = usePermission();
  const [currentInstanceId] = useAtom(currentInstanceIdAtom);
  const [jsonDrawerOpen, setJsonDrawerOpen] = useState(false);
  const [jsonDrawerData, setJsonDrawerData] = useState<{
    id: string;
    json: Record<string, unknown>;
    // The team the route belongs to: the JSON drops it, and the role in that
    // team says whether the drawer may save.
    owner: string | undefined;
  } | null>(null);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testDrawerRoute, setTestDrawerRoute] = useState<{
    id: string;
    path: string;
    method: string;
    host?: string;
    soapAction?: string;
  } | null>(null);

  const currentUser = useAtomValue(currentUserAtom);
  const { data: teams } = useQuery(teamsQueryOptions(currentUser?.id));
  // The catalogue is an admin's to read. A developer or a viewer gets the
  // names of their own teams instead - which, with several of them (#301), is
  // what tells one team's routes from another's in this list. Without it the
  // Team column showed them an id.
  // As the header read them: one read, for the switcher and for this.
  const ownTeams = useAtomValue(ownTeamsAtom)[currentInstanceId]?.teams;
  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    ownTeams?.forEach((tm) => map.set(tm.id, tm.name));
    teams?.forEach((tm) => map.set(tm.id, tm.name));
    return map;
  }, [teams, ownTeams]);

  // A route reaches its upstream directly, through a service, or inline with no
  // id at all. All three have to render as something an operator can read: an
  // empty cell would say "no backend", which is never what any of them means.
  //
  // Which of the three a row reaches is resolved by the proxy and written onto
  // it, by the rules the upstream filter applies (#161). Resolved here instead,
  // from a service list narrowed to the operator's team and cut at 500 rows, the
  // column said "no upstream" for routes the filter had just matched.
  //
  // The upstream list is still read, for names. Keyed by instance like every
  // other APISIX list (genListQueryOptions does the same): these live on the
  // gateway, and without it switching instance resolves ids against the names of
  // the one just left. Skipped entirely when the column is off — the services
  // routes list, for one, never shows it.
  const wantsUpstreams = visibleColumns.includes('upstream');
  const { data: upstreams } = useAllUpstreams(currentInstanceId, wantsUpstreams);
  const upstreamNames = useMemo(() => {
    const map = new Map<string, string>();
    upstreams?.list?.forEach((u) => map.set(u.value.id, u.value.name || u.value.id));
    return map;
  }, [upstreams]);

  // The unresolved-upstream caveat is about the Upstream column. With the column
  // off — a service's own routes list never shows it — there is nothing on
  // screen for it to be about, and nothing is missing either.
  const listWarning = (data as { __warning?: string } | undefined)?.__warning;
  const shownWarning =
    listWarning === 'service_upstream_unresolved' && !wantsUpstreams ? undefined : listWarning;

  // Every visible route stays selectable: the selection also feeds the OpenAPI
  // export, which is a read. Only the batch delete is narrowed, to the routes
  // this account may change (the role in the route's team, which is not the
  // one it holds for the instance).
  const allIds: string[] = data?.list?.map((r: { value: { id: string } }) => r.value.id) || [];
  const writableIds = useMemo(
    () =>
      new Set<string>(
        (data?.list ?? [])
          .filter((r: { value: { __team_id?: string } }) => canWriteOwner(ownerOf(r.value)))
          .map((r: { value: { id: string } }) => r.value.id)
      ),
    [data?.list, canWriteOwner]
  );
  // The rows ticked on this very list, and still on it. Kept for the life of
  // the page, the ticks of page one were still selected on page two: the bar
  // came back at the first row ticked there counting them, and Batch Delete
  // took routes nobody could see (#371).
  const [selectedIds, setSelectedIds] = useRowSelection(allIds, listKey);
  // What each row's checkbox is called: its route, with the id beside it
  // where two routes on the list share a name (see rowNames).
  const rowCheckboxNames = useMemo(
    () =>
      checkboxNames<{ value: { id: string; name?: string } }>(
        t,
        data?.list ?? [],
        rowId,
        rowNameOrId
      ),
    [t, data?.list]
  );
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;
  const someSelected = selectedIds.length > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((selected) =>
      selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id]
    );
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : allIds);
  };

  const handleExportOpenAPI = (routes: Record<string, unknown>[]) => {
    const spec = routesToOpenAPI(routes);
    downloadOpenAPI(spec);
  };

  const handleExportSelected = () => {
    const selected = data?.list
      ?.filter((r: { value: { id: string } }) => selectedIds.includes(r.value.id))
      .map((r: { value: Record<string, unknown> }) => r.value) || [];
    if (selected.length > 0) handleExportOpenAPI(selected);
  };

  const handleTestRoute = (record: Record<string, unknown>) => {
    const uri = (record.uri as string) || (record.uris as string[])?.[0] || '/';
    const method = (record.methods as string[])?.[0] || 'GET';
    const host = (record.host as string) || (record.hosts as string[])?.[0] || undefined;
    setTestDrawerRoute({
      // Converted, not cast: APISIX's id schema accepts a number, and a
      // number would be sent as one and refused by the binding.
      id: String(record.id),
      path: uri,
      method,
      host,
      soapAction: extractSoapAction(record.vars),
    });
    setTestDrawerOpen(true);
  };

  // Fail closed: no route open, no team known, no save.
  const drawerWritable = canWriteOwner(jsonDrawerData?.owner);

  const handleViewJson = (record: Record<string, unknown>) => {
    // The route as APISIX holds it, as the detail page's drawer shows it.
    setJsonDrawerData({
      id: record.id as string,
      json: withoutDashboardFields(record),
      owner: ownerOf(record),
    });
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
      notifications.show({
        // The sentence first, the reason under it: axios fills `message` on
        // every network failure, so a fallback behind it was never read.
        title: t('routes.list.duplicateFailed'),
        message: proxyFailureText(err),
        color: 'red',
      });
    }
  }, [navigate, t]);

  /**
   * Publishes a route, or takes it offline.
   *
   * The button that says Offline used to delete the route, beside a Delete in
   * the More menu that did the same - two ways to the same irreversible thing,
   * one of them named after something else entirely (#164). A route carries a
   * status the list already shows, so Offline now sets it.
   */
  const handleSetStatus = useCallback(
    async (id: string, status: 0 | 1) => {
      try {
        // Read again rather than write the row back: a PUT replaces the route,
        // and the row is as old as the last list read. Someone else's edit in
        // between would go with it.
        const fresh = await req.get<{ value: Record<string, unknown> }>(`${API_ROUTES}/${id}`);
        const body = withoutDashboardFields(fresh.data.value);
        delete body['id'];
        delete body['create_time'];
        delete body['update_time'];
        await req.put(`${API_ROUTES}/${id}`, { ...body, status });
        notifications.show({
          message: t(status === 1 ? 'info.publish.success' : 'info.unpublish.success', {
            name: t('routes.singular'),
          }),
          color: 'green',
        });
        refetch();
      } catch (err: unknown) {
        // A refusal is already on screen: the client shows what the gateway
        // said. Only what it cannot show is worth a second line.
        const e = err as { response?: unknown; message?: string };
        if (!e?.response) {
          notifications.show({
            title: t('routes.list.updateFailed'),
            message: e?.message,
            color: 'red',
          });
        }
      }
    },
    [t, refetch]
  );

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
          <Text size="sm" fw={500}>{t('form.json.selectedCount', { count: selectedIds.length })}</Text>
          <Group gap="xs">
            <BatchDeleteBtn
              ids={selectedIds.filter((id) => writableIds.has(id))}
              apiBase={API_ROUTES}
              resourceName={t('routes.singular')}
              onSuccess={refetch}
              onDeleted={(gone) =>
                      setSelectedIds((selected) => selected.filter((id) => !gone.includes(id)))
                    }
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
      <ListWarningBanner warning={shownWarning} />
      <Table horizontalSpacing="lg" verticalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 40 }}><Checkbox aria-label={t('table.selectAll')} checked={allSelected} indeterminate={someSelected && !allSelected} onChange={toggleSelectAll} /></Table.Th>
            {isVisible('name') && <Table.Th>{t('form.basic.name')}</Table.Th>}
            {isVisible('id') && <Table.Th>{t('routes.list.headerId')}</Table.Th>}
            {isVisible('host') && <Table.Th>{t('routes.list.headerHost')}</Table.Th>}
            {isVisible('path') && <Table.Th>{t('routes.list.headerPath')}</Table.Th>}
            {isVisible('upstream') && (
              <Table.Th style={{ background: 'var(--mantine-color-blue-0)' }}>
                {t('routes.list.columnUpstream')}
              </Table.Th>
            )}
            {isVisible('desc') && <Table.Th>{t('routes.list.headerDescription')}</Table.Th>}
            {isVisible('label') && <Table.Th>{t('routes.list.headerLabels')}</Table.Th>}
            {isVisible('version') && <Table.Th>{t('routes.list.headerVersion')}</Table.Th>}
            {isVisible('status') && <Table.Th>{t('routes.list.headerStatus')}</Table.Th>}
            {isVisible('update_time') && <Table.Th>{t('routes.list.headerUpdateTime')}</Table.Th>}
            {isVisible('plugin') && <Table.Th>{t('routes.list.headerPlugin')}</Table.Th>}
            {isVisible('team') && <Table.Th>{t('routes.list.headerTeam')}</Table.Th>}
            {isVisible('operation') && <Table.Th style={{ width: 1, whiteSpace: 'nowrap' }}>{t('routes.list.headerOperation')}</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {data?.list.map((record: any, index: number) => {
            const writable =
              canWriteResource('routes') && canWriteOwner(ownerOf(record.value));
            return (
            <Table.Tr key={record.value.id} className={`stagger-${(index % 5) + 1}`}>
              <Table.Td>
                <Checkbox
                  // Named after its route, or its id when it has no name: the
                  // same name on every row had a screen reader select rows for
                  // a batch delete blind (#348). The name also lands in this
                  // cell's accessible name, so a spec addresses the name cell
                  // through `uiCell`, which asks for it exactly.
                  aria-label={t('table.selectRow', {
                    name: rowCheckboxNames.get(String(record.value.id)) ?? rowNameOrId(record),
                  })}
                  checked={selectedIds.includes(record.value.id)}
                  onChange={() => toggleSelect(record.value.id)}
                />
              </Table.Td>
              {isVisible('name') && (
                <Table.Td>
                  {record.value.name ? (
                    <Text fw={600} size="sm">
                      {record.value.name}
                    </Text>
                  ) : (
                    // A name is optional in APISIX. Pinning this column would
                    // guarantee nothing if it rendered a dash for the routes
                    // that have none, so fall back to the id — always present,
                    // and styled like the ID column so it does not read as one.
                    <Text size="xs" ff="monospace" c="dimmed">
                      {record.value.id}
                    </Text>
                  )}
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
              {isVisible('upstream') && (
                <Table.Td style={{ background: 'var(--mantine-color-blue-0)' }}>
                  {(() => {
                    // What the proxy resolved for this row: the upstream it
                    // reaches, as a string whatever JSON type the id was
                    // stored as, or that it carries one inline.
                    const upstreamId: string | undefined = record.value.__upstream_id;
                    if (upstreamId) {
                      // An upstream this operator cannot list is one they cannot
                      // open either: a link would lead to a refusal. Its id still
                      // says which backend the route reaches.
                      if (!isAdmin && !upstreamNames.has(upstreamId)) {
                        return <Text size="sm">{upstreamId}</Text>;
                      }
                      return (
                        <RouteAnchor
                          to="/upstreams/detail/$id"
                          params={{ id: upstreamId }}
                          size="sm"
                        >
                          {upstreamNames.get(upstreamId) || upstreamId}
                        </RouteAnchor>
                      );
                    }
                    // An inline upstream is a real backend with no id and no
                    // name; saying so beats an empty cell that reads as none.
                    // A service carrying one inline puts its routes in the same
                    // position, one step removed.
                    if (record.value.__upstream_inline) {
                      return (
                        <Text size="xs" c="dimmed" fs="italic">
                          {t('routes.list.upstreamInline')}
                        </Text>
                      );
                    }
                    return <Text size="xs" c="dimmed">{t('routes.list.upstreamNone')}</Text>;
                  })()}
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
                  {isResourceEnabled(record.value.status) ? (
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
                    {canWriteOwner(ownerOf(record.value)) && (
                      <Button
                        size="xs"
                        color={isResourceEnabled(record.value.status) ? 'orange' : 'green'}
                        variant="filled"
                        radius="sm"
                        styles={{ root: { padding: '0 12px' } }}
                        onClick={() =>
                          handleSetStatus(
                            record.value.id,
                            isResourceEnabled(record.value.status) ? 0 : 1
                          )
                        }
                      >
                        {t(
                          isResourceEnabled(record.value.status)
                            ? 'routes.list.actionOffline'
                            : 'routes.list.actionPublish'
                        )}
                      </Button>
                    )}
                    {/* The same link either way - the detail page is where a
                        route is read as well as edited - but named and weighted
                        for what the account may actually do there. "Configure",
                        in the primary blue, promised an edit that every field
                        would refuse to save and the proxy would answer 403 to
                        (#188). Light rather than the neutral default: this is
                        still the row's primary action for a viewer, and the
                        default variant is what the "More" button beside it
                        wears. */}
                    <RouteLinkBtn
                      to="/routes/detail/$id"
                      params={{ id: record.value.id }}
                      size="xs"
                      color="blue"
                      variant={writable ? 'filled' : 'light'}
                      radius="sm"
                      styles={{ root: { padding: '0 12px' } }}
                    >
                      {t(writable ? 'form.btn.configure' : 'form.btn.view')}
                    </RouteLinkBtn>
                    <Menu shadow="md" width={160}>
                      <Menu.Target>
                        <Button size="xs" variant="default" radius="sm" rightSection={<IconArrowDropDown width="14" height="14" />}>{t('routes.list.actionMore')}</Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {/* The backend keeps the route test for those who can
                            write routes on the instance: it sends a request
                            of any method through the gateway (#307). */}
                        {writable && (
                          <Menu.Item
                            leftSection={<IconPlayArrow width="14" height="14" />}
                            onClick={() => handleTestRoute(record.value)}
                          >
                            {t('form.routeTest.title')}
                          </Menu.Item>
                        )}
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
                        {canWriteOwner(ownerOf(record.value)) && (
                          <Menu.Item
                            leftSection={<IconCopy width="14" height="14" />}
                            onClick={() => handleDuplicate(record.value)}
                          >
                            {t('form.json.duplicate')}
                          </Menu.Item>
                        )}
                        {canWriteOwner(ownerOf(record.value)) && (<>
                          <Menu.Divider />
                          {/* The same confirmation every other delete opens,
                              worn as a menu item: it names the route, and it
                              invalidates the caches other pages read. */}
                          <DeleteResourceBtn
                            allowed={canWriteOwner(ownerOf(record.value))}
                            name={t('routes.singular')}
                            target={record.value.id}
                            api={`${API_ROUTES}/${record.value.id}`}
                            onSuccess={refetch}
                            DeleteBtn={((props: { onClick?: () => void }) => (
                              <Menu.Item
                                leftSection={<IconDelete width="14" height="14" />}
                                color="red"
                                onClick={props.onClick}
                              >
                                {t('form.btn.delete')}
                              </Menu.Item>
                            )) as unknown as typeof Button}
                          />
                        </>)}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
            );
          })}
          {(!data?.list || data.list.length === 0) && (
            <Table.Tr>
              <Table.Td colSpan={visibleColumns.length + 1}>
                <Center py="xl">
                  <Stack gap={4} align="center">
                    <Text c="dimmed">{t('noData')}</Text>
                    {/* An empty table is ambiguous for a non-admin: the gateway
                        may hold plenty of routes that are simply owned by
                        another team, or by no team at all. Saying so beats
                        letting them conclude their own route vanished. */}
                    {!isAdmin && (
                      <Text c="dimmed" size="xs" ta="center" maw={460}>
                        {t('routes.list.emptyOwnershipHint')}
                      </Text>
                    )}
                  </Stack>
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
        title={drawerWritable ? t('form.json.editRaw') : t('form.json.viewRaw')}
        json={jsonDrawerData?.json ?? null}
        onSave={drawerWritable ? handleJsonSave : undefined}
        loading={jsonSaving}
      />
      <RouteTestDrawer
        opened={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        routeId={testDrawerRoute?.id ?? ''}
        defaultPath={testDrawerRoute?.path}
        defaultMethod={testDrawerRoute?.method}
        defaultHost={testDrawerRoute?.host}
        defaultSoapAction={testDrawerRoute?.soapAction}
      />
    </Paper >
  );
};


function RouteComponent() {
  const { t } = useTranslation();
  const { canEdit, isAdmin } = usePermission();
  const { params, setParams, resetParams } = useSearchParams('/routes/');
  const { data, isLoading, refetch, setParams: setRouteParams, listKey } = useRouteList('/routes/');
  // Options for the bar. Teams are admin-only; upstreams are what the new
  // filter narrows by, and the same list the table resolves names from.
  const currentUser = useAtomValue(currentUserAtom);
  const { data: filterTeams } = useQuery({
    ...teamsQueryOptions(currentUser?.id),
    enabled: isAdmin,
  });
  const teamOptions = useMemo(
    () => [
      // Resources belonging to no team are invisible to everyone but an admin,
      // so an admin is the only one who can go looking for them.
      { value: '__none__', label: t('routes.list.filterTeamUnassigned') },
      ...(filterTeams ?? []).map((tm) => ({ value: tm.id, label: tm.name })),
    ],
    [filterTeams, t]
  );
  const [currentInstanceId] = useAtom(currentInstanceIdAtom);
  const { data: filterUpstreams } = useAllUpstreams(currentInstanceId);
  // An import labels the routes it writes — the WSDL one always does — so the
  // labels the filter offers are read again along with the table (#190).
  const onImported = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['routes', currentInstanceId, 'all'] });
  };
  const upstreamOptions = useMemo(
    () =>
      (filterUpstreams?.list ?? []).map((u) => ({
        value: u.value.id,
        label: u.value.name || u.value.id,
      })),
    [filterUpstreams]
  );

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [wsdlModalOpen, setWsdlModalOpen] = useState(false);


  // Name is not in this list on purpose. Every column here can be switched
  // off, and switching all of them off used to leave a table of nothing but
  // action buttons — rows with no way to tell which route each one was. Keeping
  // the identifying column out of the toggleable set makes that unreachable by
  // construction, rather than relying on a "keep at least one" check.
  // The same keys the table headers read, so that a column is called the same
  // thing in the picker as above the column it switches on. Nothing enforces
  // that: an array built here has no JSX ancestor, so the rule that holds this
  // screen's attributes to i18n cannot see these labels at all.
  const ALL_COLUMNS = [
    { label: t('routes.list.headerId'), value: 'id' },
    { label: t('routes.list.headerHost'), value: 'host' },
    { label: t('routes.list.headerPath'), value: 'path' },
    { label: t('routes.list.columnUpstream'), value: 'upstream' },
    { label: t('routes.list.headerDescription'), value: 'desc' },
    { label: t('routes.list.headerLabels'), value: 'label' },
    { label: t('routes.list.headerVersion'), value: 'version' },
    { label: t('routes.list.headerStatus'), value: 'status' },
    { label: t('routes.list.headerUpdateTime'), value: 'update_time' },
    { label: t('routes.list.headerPlugin'), value: 'plugin' },
    { label: t('routes.list.headerTeam'), value: 'team' },
  ];

  const DEFAULT_COLUMNS = ['name', 'path', 'upstream', 'label', 'status', 'update_time', 'plugin', 'team', 'operation'];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);

  return (
    <Box className="animate-fade-in-up" bg="#f0f2f5" style={{ minHeight: '100vh', width: '100%' }}>
      <PageHeader title={t('sources.routes')} />

      <RoutesFilterBar
        params={params as RouteFilters}
        onSearch={setParams}
        onReset={resetParams}
        isAdmin={isAdmin}
        teamOptions={teamOptions}
        upstreamOptions={upstreamOptions}
      />

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
            {canEdit && (
              <Button
                variant="default"
                size="sm"
                leftSection={<IconUpload width="16" height="16" />}
                onClick={() => setWsdlModalOpen(true)}
              >
                {t('form.importWsdl.title')}
              </Button>
            )}
            <ActionIcon variant="subtle" color="gray" size="md" onClick={() => refetch()} aria-label={t('routes.list.refresh')}><IconRefresh width="18" height="18" /></ActionIcon>
            <Popover width={200} position="bottom-end" withArrow shadow="md">
              <Popover.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="md"
                  aria-label={t('routes.list.columnsTitle')}
                >
                  <IconSettings width="18" height="18" />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown p="xs">
                <Group justify="space-between" mb="xs">
                  <Text size="xs" fw={700}>{t('routes.list.columnsTitle')}</Text>
                  <Anchor size="xs" component="button" onClick={() => setVisibleColumns(DEFAULT_COLUMNS)}>{t('routes.list.columnsReset')}</Anchor>
                </Group>

                <Text size="xs" c="dimmed" mb={4}>{t('routes.list.columnsFixed')}</Text>
                <Checkbox
                  size="xs"
                  label={t('form.basic.name')}
                  checked
                  disabled
                  description={t('routes.list.columnsNameAlwaysShown')}
                />

                <Divider my="xs" />
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
                  label={t('routes.list.headerOperation')}
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
          data={data}
          isLoading={isLoading}
          refetch={refetch}
          setParams={setRouteParams}
          visibleColumns={visibleColumns}
          listKey={listKey}
        />
      </Paper>

      <ImportRoutesModal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={onImported}
      />
      <ImportWsdlModal
        opened={wsdlModalOpen}
        onClose={() => setWsdlModalOpen(false)}
        onSuccess={onImported}
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
