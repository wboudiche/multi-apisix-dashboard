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
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { Badge, Stack, Text, Tooltip } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getUpstreamListQueryOptions, useUpstreamList } from '@/apis/hooks';
import { RouteLinkBtn } from '@/components/Btn';
import { BatchDeleteBtn } from '@/components/page/BatchDeleteBtn';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import { ListWarningBanner } from '@/components/page/ListWarningBanner';
import PageHeader from '@/components/page/PageHeader';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import type { UpstreamRow } from '@/components/page-slice/upstreams/upstream-row';
import { nodeCount } from '@/components/page-slice/upstreams/upstream-row';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_UPSTREAMS } from '@/config/constant';
import { queryClient } from '@/config/global';
import { usePermission } from '@/hooks/usePermission';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import type { HealthNode } from '@/utils/upstream-health';
import { summarizeHealth } from '@/utils/upstream-health';

function RouteComponent() {
  const { t } = useTranslation();
  const { canWriteResource } = usePermission();
  const { data, isLoading, refetch, pagination } = useUpstreamList();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // The proxy says so when it could not count: a page that showed nothing
  // would be claiming the upstreams are free of dependants (#144).
  const listWarning = (data as { __warning?: string } | undefined)?.__warning;

  const columns = useMemo<ProColumns<UpstreamRow>[]>(() => {
    return [
      {
        dataIndex: ['value', 'id'],
        title: 'ID',
        key: 'id',
        valueType: 'text',
      },
      {
        dataIndex: ['value', 'name'],
        title: t('form.basic.name'),
        key: 'name',
        valueType: 'text',
      },
      {
        dataIndex: ['value', 'scheme'],
        title: t('form.upstreams.scheme'),
        key: 'scheme',
        valueType: 'text',
      },
      {
        dataIndex: ['value', 'nodes'],
        title: t('upstreams.nodes'),
        key: 'nodes',
        render: (_, record) => {
          // An upstream that resolves its nodes through discovery has none to
          // count here. Naming the mechanism says why the cell is not a
          // number, where a dash would read as "no backends".
          const count = nodeCount(record.value.nodes);
          if (count === undefined) {
            const discovery = record.value.discovery_type;
            if (discovery) return t('upstreams.viaDiscovery', { discovery });
            return '-';
          }
          return <Text span data-testid="upstream-node-count">{count}</Text>;
        },
      },
      {
        dataIndex: ['value', '__health'],
        title: t('upstreams.health'),
        key: 'health',
        render: (_, record) => {
          // Four answers, and only two of them are measurements. A gateway
          // that exposes no Control API, and an upstream nothing watches, are
          // not upstreams in trouble - and a colour for either would be a
          // claim nobody made (#281).
          const health = summarizeHealth(record.value.__health);
          if (health.state === 'unknown') {
            return (
              <Tooltip label={t('upstreams.healthUnknownHint')} withArrow multiline w={260}>
                <Text size="sm" c="dimmed" data-testid="upstream-health">
                  {t('upstreams.healthUnknown')}
                </Text>
              </Tooltip>
            );
          }
          if (health.state === 'unchecked') {
            return (
              <Tooltip label={t('upstreams.healthUncheckedHint')} withArrow multiline w={260}>
                <Text size="sm" c="dimmed" data-testid="upstream-health">
                  {t('upstreams.healthUnchecked')}
                </Text>
              </Tooltip>
            );
          }
          if (health.state === 'pending') {
            return (
              <Badge variant="outline" color="gray" size="sm" data-testid="upstream-health">
                {t('upstreams.healthPending')}
              </Badge>
            );
          }

          // The nodes themselves, so the number is answerable: which one is
          // down, and on which port.
          const nodes = (
            (record.value.__health as { nodes?: HealthNode[] })?.nodes ?? []
            // `||`, not `??`: the backend writes an empty host when the
            // checker named none, and ":1980 - healthy" reads as a mistake.
          ).map((node) => `${node.host || '?'}:${node.port || '?'} - ${node.status || '?'}`);

          return (
            <Tooltip
              label={
                <Stack gap={0}>
                  {nodes.map((line) => (
                    <Text key={line} size="xs">
                      {line}
                    </Text>
                  ))}
                </Stack>
              }
              withArrow
            >
              <Badge
                variant="light"
                size="sm"
                color={health.state === 'up' ? 'green' : health.state === 'down' ? 'red' : 'orange'}
                data-testid="upstream-health"
              >
                {t('upstreams.healthNodes', { up: health.up, total: health.total })}
              </Badge>
            </Tooltip>
          );
        },
      },
      {
        dataIndex: ['value', '__route_count'],
        title: t('upstreams.usedBy'),
        key: 'used_by',
        render: (_, record) => {
          // Counted by the proxy over the whole gateway, the only place the
          // number is true: this page's own lists are narrowed to the reader's
          // team (#144, after #277). Absent means it could not be counted, and
          // the banner above says so.
          const routes = record.value.__route_count;
          if (typeof routes !== 'number') return '-';

          const services = record.value.__service_count;
          const stream = record.value.__stream_route_count;
          return (
            <>
              <Text span data-testid="upstream-route-count">
                {t('upstreams.routesWithCount', { count: routes })}
              </Text>
              {/* Only when there are any: a service or a stream route is the
                  uncommon way to reach an upstream, and a row of zeros would
                  bury the number that matters. */}
              {!!services && (
                <Text size="xs" c="dimmed">
                  {t('upstreams.servicesWithCount', { count: services })}
                </Text>
              )}
              {!!stream && (
                <Text size="xs" c="dimmed">
                  {t('upstreams.streamRoutesWithCount', { count: stream })}
                </Text>
              )}
            </>
          );
        },
      },
      {
        dataIndex: ['value', 'update_time'],
        title: t('form.upstreams.updateTime'),
        key: 'update_time',
        valueType: 'dateTime',
        renderText: (text) => {
          if (!text) return '-';
          return new Date(Number(text) * 1000).toISOString();
        },
      },
      {
        title: t('table.actions'),
        valueType: 'option',
        key: 'option',
        width: 200,
        render: (_, record) => [
          <RouteLinkBtn
            key="detail"
            to="/upstreams/detail/$id"
            params={{ id: record.value.id }}
            size="xs"
            color="blue"
            variant={canWriteResource('upstreams') ? 'filled' : 'light'}
            radius="sm"
            styles={{ root: { padding: '0 12px' } }}
          >
            {t(
              canWriteResource('upstreams') ? 'form.btn.configure' : 'form.btn.view'
            )}
          </RouteLinkBtn>,
          <DeleteResourceBtn
            key="delete"
            name={t('upstreams.singular')}
            target={record.value.id}
            api={`${API_UPSTREAMS}/${record.value.id}`}
            onSuccess={refetch}
            size="xs"
            color="red"
            variant="filled"
            radius="sm"
            styles={{ root: { padding: '0 12px' } }}
          />,
        ],
      },
    ];
  }, [t, refetch, canWriteResource]);

  return (
    <>
      <PageHeader title={t('sources.upstreams')} />
      <ListWarningBanner warning={listWarning} />
      <AntdConfigProvider>
        <ProTable
          columns={columns}
          dataSource={data?.list as UpstreamRow[]}
          rowKey={(record) => record.value.id}
          loading={isLoading}
          search={false}
          options={false}
          pagination={pagination}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
          }}
          cardProps={{ bodyStyle: { padding: 0 } }}
          toolbar={{
            menu: {
              type: 'inline',
              items: [
                {
                  key: 'add',
                  label: (
                    <ToAddPageBtn
                      key="add"
                      to="/upstreams/add"
                      label={t('info.add.title', {
                        name: t('upstreams.singular'),
                      })}
                    />
                  ),
                },
                {
                  key: 'batchDelete',
                  label: (
                    <BatchDeleteBtn
                      ids={selectedIds}
                      apiBase={API_UPSTREAMS}
                      resourceName={t('upstreams.singular')}
                      onSuccess={refetch}
                      onClearSelection={() => setSelectedIds([])}
                    />
                  ),
                },
              ],
            },
          }}
        />
      </AntdConfigProvider>
    </>
  );
}

export const Route = createFileRoute('/upstreams/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getUpstreamListQueryOptions(deps)),
});
