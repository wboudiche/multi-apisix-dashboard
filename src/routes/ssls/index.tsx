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
import { Alert, Badge } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getSSLListQueryOptions, useSSLList } from '@/apis/hooks';
import { getSSLListReq } from '@/apis/ssls';
import { BatchDeleteBtn } from '@/components/page/BatchDeleteBtn';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { ToAddPageBtn, ToDetailPageBtn } from '@/components/page/ToAddPageBtn';
import { AntdConfigProvider } from '@/config/antdConfigProvider';
import { API_SSLS, PAGE_SIZE_MAX } from '@/config/constant';
import { queryClient } from '@/config/global';
import i18n from '@/config/i18n';
import { reqFor } from '@/config/req';
import { currentInstanceIdAtom } from '@/stores/instance';
import type { APISIXType } from '@/types/schema/apisix';
import { pageSearchSchema } from '@/types/schema/pageSearch';
import { certExpiry, EXPIRY_WARNING_DAYS } from '@/utils/cert-expiry';
import { isResourceEnabled } from '@/utils/status';
import IconWarning from '~icons/material-symbols/warning-outline';

/**
 * A list row, with what the proxy read out of the certificate.
 *
 * `__cert_not_after` is not part of an APISIX SSL - the gateway stores the PEM
 * and nothing else - so it is declared here rather than in the schema, beside
 * the one page that reads it (#145).
 */
type SSLRow = APISIXType['RespSSLItem'] & {
  value: { __cert_not_after?: string; __cert_issuer?: string };
};

function RouteComponent() {
  const { t } = useTranslation();
  const { data, isLoading, refetch, pagination } = useSSLList();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const currentInstanceId = useAtomValue(currentInstanceIdAtom);

  // The whole list, not the page being shown. A banner counted over ten rows
  // says nothing about the certificate expiring on page three, while reading
  // like a total - and a gateway with forty certificates is exactly where this
  // is worth having (#145).
  const { data: everySSL } = useQuery({
    queryKey: ['ssls', currentInstanceId, 'all'],
    queryFn: () => getSSLListReq(reqFor(currentInstanceId), { page: 1, page_size: PAGE_SIZE_MAX }),
    staleTime: 60_000,
  });

  // Expired as well as expiring: a certificate that has already lapsed is the
  // worse of the two, and counting only the ones still in their last thirty
  // days left it with nothing above the table at all.
  const needAttention = useMemo(
    () =>
      ((everySSL?.list ?? []) as SSLRow[]).filter(
        (item) => certExpiry(item.value.__cert_not_after)?.state !== 'ok'
      ).length,
    [everySSL]
  );

  const columns = useMemo<ProColumns<SSLRow>[]>(() => {
    return [
      {
        dataIndex: ['value', 'id'],
        title: 'ID',
        key: 'id',
        valueType: 'text',
      },
      {
        dataIndex: ['value', 'sni'],
        title: 'SNI',
        key: 'sni',
        valueType: 'text',
        render: (_, record) => {
          // Show sni if available, otherwise show the first snis entry
          const sni = record.value.sni;
          const snis = record.value.snis;
          if (sni) return sni;
          if (snis && snis.length > 0) return snis.join(', ');
          return '-';
        },
      },
      {
        dataIndex: ['value', 'status'],
        title: t('form.basic.status'),
        key: 'status',
        // Rendered rather than mapped through valueEnum: an absent status is
        // live, and a map keyed on 1/0 has no entry for it, so those rows came
        // up blank instead of enabled.
        render: (_, record) => (
          <Badge
            color={isResourceEnabled(record.value.status) ? 'green' : 'red'}
            variant="light"
            size="sm"
          >
            {isResourceEnabled(record.value.status)
              ? t('table.enabled')
              : t('table.disabled')}
          </Badge>
        ),
      },
      {
        dataIndex: ['value', '__cert_not_after'],
        title: t('ssls.expires'),
        key: 'expires',
        render: (_, record) => {
          // What APISIX stores is the PEM; the date comes from the proxy
          // parsing it (#145). A row it could not read says nothing rather
          // than showing a date nobody can account for.
          const expiry = certExpiry(record.value.__cert_not_after);
          if (!expiry) return '-';

          const { days, state } = expiry;
          return (
            <Badge
              color={state === 'expired' ? 'red' : state === 'soon' ? 'orange' : 'green'}
              variant="light"
              size="sm"
            >
              {state === 'expired'
                ? t('ssls.expired')
                : // Intl rather than a translated "in {{days}} days": it gets
                  // the plural rules of each language right on its own.
                  new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(
                    days,
                    'day'
                  )}
            </Badge>
          );
        },
      },
      {
        title: t('table.actions'),
        valueType: 'option',
        key: 'option',
        width: 120,
        render: (_, record) => [
          <ToDetailPageBtn
            resource="ssls"
            key="detail"
            to="/ssls/detail/$id"
            params={{ id: record.value.id }}
          />,
          <DeleteResourceBtn
            key="delete"
            name={t('ssls.singular')}
            target={record.value.id}
            api={`${API_SSLS}/${record.value.id}`}
            onSuccess={refetch}
          />,
        ],
      },
    ];
  }, [t, refetch]);

  return (
    <>
      <PageHeader title={t('sources.ssls')} />
      {needAttention > 0 && (
        // Above the table, because the point is to be seen without reading it:
        // a certificate that lapses takes the gateway's TLS with it, and the
        // list gave no warning at all before (#145).
        <Alert color="orange" variant="light" mb="md" icon={<IconWarning width="18" height="18" />}>
          {t('ssls.expiringSoon', { count: needAttention, days: EXPIRY_WARNING_DAYS })}
        </Alert>
      )}
      <AntdConfigProvider>
        <ProTable
          columns={columns}
          dataSource={data?.list}
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
                      to="/ssls/add"
                      label={t('info.add.title', { name: t('ssls.singular') })}
                    />
                  ),
                },
                {
                  key: 'batchDelete',
                  label: (
                    <BatchDeleteBtn
                      ids={selectedIds}
                      apiBase={API_SSLS}
                      resourceName={t('ssls.singular')}
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

export const Route = createFileRoute('/ssls/')({
  component: RouteComponent,
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    queryClient.ensureQueryData(getSSLListQueryOptions(deps)),
});
