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
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Group, Skeleton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  queryOptions,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBoolean } from 'react-use';

import { getUpstreamReq, putUpstreamReq } from '@/apis/upstreams';
import { FormPartBasic } from '@/components/form-slice/FormPartBasic';
import {
  FormSectionChecks,
  FormSectionConnection,
  FormSectionNodesAndDiscovery,
} from '@/components/form-slice/FormPartUpstream';
import { FormPartUpstreamSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { UpstreamPreviewSummary } from '@/components/form-slice/FormPartUpstream/UpstreamPreviewSummary';
import { produceToUpstreamForm } from '@/components/form-slice/FormPartUpstream/util';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { FormWizard } from '@/components/form-slice/FormWizard';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_UPSTREAMS } from '@/config/constant';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import type { APISIXType } from '@/types/schema/apisix';
import { pipeProduce } from '@/utils/producer';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const getUpstreamQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['upstream', id],
    queryFn: () => getUpstreamReq(req, id),
  });

const UpstreamDetailForm = (
  props: Props & Pick<APISIXType['Upstream'], 'id'>
) => {
  const { id, readOnly, setReadOnly } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    data: { value: upstreamData },
    isLoading,
    refetch,
  } = useSuspenseQuery(getUpstreamQueryOptions(id));

  const form = useForm({
    resolver: zodResolver(FormPartUpstreamSchema),
    shouldUnregister: false,
    mode: 'all',
    disabled: readOnly,
  });

  const putUpstream = useMutation({
    mutationFn: (d: APISIXType['Upstream']) => putUpstreamReq(req, d),
    async onSuccess() {
      notifications.show({
        message: t('info.edit.success', { name: t('upstreams.singular') }),
        color: 'green',
      });
      await refetch();
      setReadOnly(true);
    },
  });

  useEffect(() => {
    if (upstreamData && !isLoading) {
      form.reset(produceToUpstreamForm(upstreamData));
    }
  }, [upstreamData, form, isLoading]);

  const steps = [
    {
      label: t('form.upstreams.steps.basic'),
      description: t('form.upstreams.steps.basicDesc'),
      content: (
        <>
          <FormSectionGeneral readOnly />
          <FormPartBasic />
        </>
      ),
      fields: ['name', 'desc', 'labels'],
    },
    {
      label: t('form.upstreams.steps.nodes'),
      description: t('form.upstreams.steps.nodesDesc'),
      content: <FormSectionNodesAndDiscovery />,
      fields: ['nodes', 'service_name', 'discovery_type'],
    },
    {
      label: t('form.upstreams.steps.connection'),
      description: t('form.upstreams.steps.connectionDesc'),
      content: (
        <>
          <FormSectionConnection />
          <FormSectionChecks />
        </>
      ),
      fields: ['scheme', 'type', 'timeout', 'retries'],
    },
    {
      label: t('form.upstreams.steps.preview'),
      description: t('form.upstreams.steps.previewDesc'),
      content: <UpstreamPreviewSummary data={readOnly ? upstreamData : undefined} />,
    },
  ];

  if (isLoading) {
    return <Skeleton height={400} />;
  }

  return (
    <FormProvider {...form}>
      <FormWizard
        steps={steps}
        onComplete={form.handleSubmit((d) => {
          putUpstream.mutateAsync(pipeProduce()(d));
        })}
        loading={putUpstream.isPending}
        onCancel={() => setReadOnly(true)}
        onBackToList={() => navigate({ to: '/upstreams' })}
        readOnly={readOnly}
      />
    </FormProvider>
  );
};

function RouteComponent() {
  const { t } = useTranslation();
  const { id } = useParams({ from: '/upstreams/detail/$id' });
  const [readOnly, setReadOnly] = useBoolean(true);
  const { canEdit } = usePermission();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title={t('info.edit.title', { name: t('upstreams.singular') })}
        {...(readOnly && {
          title: t('info.detail.title', { name: t('upstreams.singular') }),
          extra: (
            <Group>
              {canEdit && (
                <Button
                  onClick={() => setReadOnly(false)}
                  size="compact-sm"
                  variant="gradient"
                >
                  {t('form.btn.edit')}
                </Button>
              )}
              <DeleteResourceBtn
                mode="detail"
                name={t('upstreams.singular')}
                target={id}
                api={`${API_UPSTREAMS}/${id}`}
                onSuccess={() => navigate({ to: '/upstreams' })}
              />
            </Group>
          ),
        })}
      />
      <UpstreamDetailForm
        id={id}
        readOnly={readOnly}
        setReadOnly={setReadOnly}
      />
    </>
  );
}

export const Route = createFileRoute('/upstreams/detail/$id')({
  component: RouteComponent,
});
