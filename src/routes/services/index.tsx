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
import { Group, Pagination, SegmentedControl, Stack, Text } from '@mantine/core';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { getServiceListQueryOptions, useServiceList } from '@/apis/hooks';
import { RouteLinkBtn } from '@/components/Btn';
import { BatchDeleteBtn } from '@/components/page/BatchDeleteBtn';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import { ListWarningBanner } from '@/components/page/ListWarningBanner';
import PageHeader from '@/components/page/PageHeader';
import { ToAddPageBtn } from '@/components/page/ToAddPageBtn';
import type { ServiceRow } from '@/components/page-slice/services/service-row';
import { ServiceCards } from '@/components/page-slice/services/ServiceCards';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_SERVICES } from '@/config/constant';
import { queryClient } from '@/config/global';
import { usePermission } from '@/hooks/usePermission';
import { pageSearchSchema } from '@/types/schema/pageSearch';

/**
 * Which view the list is in, carried in the URL.
 *
 * In the URL rather than in component state so the choice survives a reload
 * and travels in a link - the table stays the default, as it is what every
 * other resource list looks like (#143).
 */
const servicesSearchSchema = pageSearchSchema.extend({
  view: z.enum(['table', 'cards']).optional().default('table'),
});

const ServiceList = () => {
  const { data, isLoading, refetch, pagination } = useServiceList();
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: '/services/' });
  const setView = (next: 'table' | 'cards') => {
    // The selection belongs to the table's checkboxes, which the cards do not
    // have: carried across, it would still be counted by Batch Delete on the
    // way back, including ids deleted from a card in the meantime.
    setSelectedIds([]);
    navigate({ search: (prev) => ({ ...prev, view: next }) });
  };
  const { t } = useTranslation();
  const { canWriteResource } = usePermission();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // The proxy says so when it could not count: without this the table and the
  // cards would show a service with no dependants and one whose dependants
  // could not be read exactly alike (#277).
  const listWarning = (data as { __warning?: string } | undefined)?.__warning;

  const columns = useMemo<ProColumns<ServiceRow>[]>(() => {
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
        dataIndex: ['value', 'desc'],
        title: t('form.basic.desc'),
        key: 'desc',
        valueType: 'text',
      },
      {
        dataIndex: ['value', '__route_count'],
        title: t('services.routes'),
        key: 'route_count',
        render: (_, record) => {
          // Counted by the proxy over the whole gateway, which is the only
          // place the number is true (#277). Absent means it could not be
          // counted, and the banner above says so - a zero here would read as
          // "safe to delete".
          const routes = record.value.__route_count;
          if (typeof routes !== 'number') return '-';

          // The header already says Routes, so the cell is the number. The
          // stream count is named, because nothing else on the row would say
          // which kind it is - and most services have none.
          const stream = record.value.__stream_route_count;
          return (
            <>
              {/* A node of its own rather than a bare text child: beside the
                  stream line the cell would otherwise be one run of text,
                  which neither a reader nor a test can take the number out
                  of. */}
              <Text span data-testid="service-route-count">
                {routes}
              </Text>
              {!!stream && (
                <Text size="xs" c="dimmed">
                  {t('services.streamRoutesWithCount', { count: stream })}
                </Text>
              )}
            </>
          );
        },
      },
      {
        dataIndex: ['value', 'update_time'],
        title: t('form.info.update_time'),
        key: 'update_time',
        valueType: 'dateTime',
        sorter: true,
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
            to="/services/detail/$id"
            params={{ id: record.value.id }}
            size="xs"
            color="blue"
            variant={canWriteResource('services') ? 'filled' : 'light'}
            radius="sm"
            styles={{ root: { padding: '0 12px' } }}
          >
            {t(
              canWriteResource('services') ? 'form.btn.configure' : 'form.btn.view'
            )}
          </RouteLinkBtn>,
          <DeleteResourceBtn
            key="delete"
            name={t('services.singular')}
            target={record.value.id}
            api={`${API_SERVICES}/${record.value.id}`}
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

  const viewSwitch = (
    <SegmentedControl
      size="xs"
      value={view}
      aria-label={t('services.viewSwitch')}
      onChange={(next) => setView(next as 'table' | 'cards')}
      data={[
        { value: 'table', label: t('services.viewTable') },
        { value: 'cards', label: t('services.viewCards') },
      ]}
    />
  );

  if (view === 'cards') {
    return (
      <Stack gap="md">
        <Group justify="space-between">
          <ToAddPageBtn
            label={t('info.add.title', { name: t('services.singular') })}
            to="/services/add"
          />
          {viewSwitch}
        </Group>
        <ListWarningBanner warning={listWarning} />
        <ServiceCards services={data.list as ServiceRow[]} onDeleted={refetch} />
        {/* The cards show a page, like the table does; without this there was
            no way to reach the second one but to edit the URL. */}
        {(pagination.total ?? 0) > (pagination.pageSize ?? 10) && (
          <Group justify="center">
            <Pagination
              value={pagination.current ?? 1}
              total={Math.ceil((pagination.total ?? 0) / (pagination.pageSize ?? 10))}
              onChange={(page) =>
                pagination.onChange?.(page, pagination.pageSize ?? 10)
              }
            />
          </Group>
        )}
      </Stack>
    );
  }

  return (
    <AntdConfigProvider>
      <ListWarningBanner warning={listWarning} />
      <ProTable
        columns={columns}
        dataSource={data.list as ServiceRow[]}
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
                    label={t('info.add.title', {
                      name: t('services.singular'),
                    })}
                    to="/services/add"
                  />
                ),
              },
              {
                key: 'view',
                label: viewSwitch,
              },
              {
                key: 'batchDelete',
                label: (
                  <BatchDeleteBtn
                    ids={selectedIds}
                    apiBase={API_SERVICES}
                    resourceName={t('services.singular')}
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
  );
};

function RouteComponent() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('sources.services')} />
      <AntdConfigProvider>
        <ServiceList />
      </AntdConfigProvider>
    </>
  );
}

export const Route = createFileRoute('/services/')({
  component: RouteComponent,
  validateSearch: servicesSearchSchema,
  // Without `view`: it decides how the list is drawn, not which list. In the
  // deps it made each switch a new query key, so flipping the control refetched
  // the same services - and sent ?view=cards on to APISIX, which has no use
  // for it.
  loaderDeps: ({ search }) => {
    const { view, ...listParams } = search;
    void view;
    return listParams;
  },
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getServiceListQueryOptions(deps)),
});
