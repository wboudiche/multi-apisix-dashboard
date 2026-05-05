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
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBoolean } from 'react-use';

import { getServiceQueryOptions } from '@/apis/hooks';
import { putServiceReq } from '@/apis/services';
import { FormPartBasic } from '@/components/form-slice/FormPartBasic';
import { FormSectionUpstream } from '@/components/form-slice/FormPartRoute';
import {
  FormItemHostsList,
  FormSectionPlugins,
} from '@/components/form-slice/FormPartService';
import { ServicePreviewSummary } from '@/components/form-slice/FormPartService/ServicePreviewSummary';
import { FormWizard } from '@/components/form-slice/FormWizard';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { API_SERVICES } from '@/config/constant';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { produceRmUpstreamWhenHas } from '@/utils/form-producer';
import { pipeProduce } from '@/utils/producer';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
};

const ServiceDetailForm = (props: Props) => {
  const { readOnly, setReadOnly } = props;
  const { t } = useTranslation();
  const { id } = useParams({ from: '/services/detail/$id' });
  const navigate = useNavigate();

  const serviceQuery = useSuspenseQuery(getServiceQueryOptions(id));
  const { data: serviceData, isLoading, refetch } = serviceQuery;

  const form = useForm({
    resolver: zodResolver(APISIX.Service),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    if (serviceData?.value && !isLoading) {
      form.reset(serviceData.value);
    }
  }, [serviceData, form, isLoading]);

  const putService = useMutation({
    mutationFn: (d: APISIXType['Service']) =>
      putServiceReq(
        req,
        pipeProduce(produceRmUpstreamWhenHas('upstream_id'))(d)
      ),
    async onSuccess() {
      notifications.show({
        message: t('info.edit.success', { name: t('services.singular') }),
        color: 'green',
      });
      await refetch();
      setReadOnly(true);
    },
  });

  // Match legacy dashboard: Basic (with upstream) -> Plugin -> Preview
  const steps = [
    {
      label: t('form.basic.title'),
      description: 'Service basic configuration',
      content: (
        <>
          <FormPartBasic
            showGeneral={false}
            showLabels={false}
            showStatus={false}
            legend=""
            withBorder={false}
            shadow="none"
            p={0}
            mb={0}
          />
          <FormItemHostsList />
        </>
      ),
      fields: ['name', 'desc'],
    },
    {
      label: 'Upstream',
      description: 'Configure upstream',
      content: (
        <FormSectionUpstream
          simplified
          legend=""
          withBorder={false}
          shadow="none"
          p={0}
          mb={0}
        />
      ),
      fields: ['upstream', 'upstream_id'],
    },
    {
      label: 'Plugin',
      description: 'Configure plugins',
      content: <FormSectionPlugins />,
      fields: ['plugins'],
    },
    {
      label: 'Preview',
      description: 'Review and finish',
      content: <ServicePreviewSummary data={readOnly ? serviceData?.value : undefined} />,
    },
  ];

  if (isLoading) {
    return <Skeleton height={400} />;
  }

  return (
    <FormProvider {...form}>
      <FormWizard
        steps={steps}
        onComplete={form.handleSubmit((d) => putService.mutateAsync(d))}
        loading={putService.isPending}
        onCancel={() => setReadOnly(true)}
        onBackToList={() => navigate({ to: '/services' })}
        readOnly={readOnly}
      />
    </FormProvider>
  );
};

function RouteComponent() {
  const { t } = useTranslation();
  const [readOnly, setReadOnly] = useBoolean(true);
  const { canEdit } = usePermission();
  const { id } = useParams({ from: '/services/detail/$id' });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title={t('info.edit.title', { name: t('services.singular') })}
        {...(readOnly && {
          title: t('info.detail.title', { name: t('services.singular') }),
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
                name={t('services.singular')}
                target={id}
                api={`${API_SERVICES}/${id}`}
                onSuccess={() => navigate({ to: '/services' })}
              />
            </Group>
          ),
        })}
      />
      <ServiceDetailForm readOnly={readOnly} setReadOnly={setReadOnly} />
    </>
  );
}

export const Route = createFileRoute('/services/detail/$id/')({
  component: RouteComponent,
});
