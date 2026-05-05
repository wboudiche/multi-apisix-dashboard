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
import { Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { postServiceReq, type ServicePostType } from '@/apis/services';
import { FormPartBasic } from '@/components/form-slice/FormPartBasic';
import { FormSectionUpstream } from '@/components/form-slice/FormPartRoute';
import {
  FormItemHostsList,
  FormSectionPlugins,
} from '@/components/form-slice/FormPartService';
import { ServicePostSchema } from '@/components/form-slice/FormPartService/schema';
import { ServicePreviewSummary } from '@/components/form-slice/FormPartService/ServicePreviewSummary';
import { FormWizard } from '@/components/form-slice/FormWizard';
import PageHeader from '@/components/page/PageHeader';
import { req } from '@/config/req';
import { useFormDraftAutoSave } from '@/hooks/useFormDraftAutoSave';
import {
  produceCleanEmpty,
  produceRmUpstreamWhenHas,
} from '@/utils/form-producer';
import { pipeProduce } from '@/utils/producer';

const DRAFT_KEY = 'apisix-service-draft';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultValues: any = {
  upstream_id: 'custom',
  upstream: {
    scheme: 'http',
    type: 'roundrobin',
    timeout: {
      connect: 6,
      send: 6,
      read: 6,
    },
    keepalive_pool: {
      size: 320,
      idle_timeout: 60,
      requests: 1000,
    },
    pass_host: 'pass',
    checks: {
      active: {
        timeout: 5,
        http_path: '/',
        healthy: {
          interval: 2,
          successes: 2,
        },
        unhealthy: {
          interval: 1,
          http_failures: 2,
        },
      },
      passive: {
        healthy: {
          successes: 2,
        },
        unhealthy: {
          http_failures: 2,
        },
      },
    },
  },
};

const ServiceAddForm = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const draftNotifiedRef = useRef(false);

  const savedDraft = useRef<Partial<ServicePostType> | undefined>(undefined);
  if (!savedDraft.current) {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) savedDraft.current = JSON.parse(saved);
    } catch { /* ignore */ }
  }

  const form = useForm({
    resolver: zodResolver(ServicePostSchema),
    defaultValues: savedDraft.current || defaultValues,
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'onTouched',
  });

  const { clearDraft } = useFormDraftAutoSave(DRAFT_KEY, form);

  const postService = useMutation({
    mutationFn: (d: ServicePostType) =>
      postServiceReq(
        req,
        pipeProduce(
          produceRmUpstreamWhenHas('upstream_id'),
          produceCleanEmpty
        )(d)
      ),
    async onSuccess() {
      clearDraft();
      notifications.show({
        message: t('info.add.success', { name: t('services.singular') }),
        color: 'green',
      });
      await router.navigate({ to: '/services' });
    },
  });

  useEffect(() => {
    if (savedDraft.current && !draftNotifiedRef.current) {
      draftNotifiedRef.current = true;
      notifications.show({
        message: t('form.draft.restored'),
        color: 'blue',
        autoClose: 5000,
      });
    }
  }, [t]);

  const steps = [
    {
      label: t('form.services.steps.basic'),
      description: t('form.services.steps.basicDesc'),
      content: (
        <>
          <FormPartBasic
            showGeneral={false}
            showLabels={false}
            showStatus={false}
            namePlaceholder={t('form.services.namePlaceholder')}
            descPlaceholder={t('form.services.descPlaceholder')}
            nameTooltip={t('form.services.tooltip.name')}
            descTooltip={t('form.services.tooltip.desc')}
          >
            <FormItemHostsList />
          </FormPartBasic>
        </>
      ),
      fields: ['name'],
    },
    {
      label: t('form.services.steps.upstream'),
      description: t('form.services.steps.upstreamDesc'),
      content: (
        <FormSectionUpstream
          simplified
        />
      ),
      fields: [
        'upstream.type',
        'upstream.scheme',
        'upstream.timeout.connect',
        'upstream.timeout.send',
        'upstream.timeout.read',
        'upstream.nodes',
      ],
    },
    {
      label: t('form.services.steps.plugin'),
      description: t('form.services.steps.pluginDesc'),
      content: <FormSectionPlugins />,
      fields: [],
    },
    {
      label: t('form.services.steps.preview'),
      description: t('form.services.steps.previewDesc'),
      content: <ServicePreviewSummary />,
    },
  ];

  return (
    <FormProvider {...form}>
      {savedDraft.current && (
        <Group justify="flex-end" mb="xs">
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            onClick={() => {
              clearDraft();
              form.reset(defaultValues);
              savedDraft.current = undefined;
            }}
          >
            {t('form.draft.discard')}
          </Button>
        </Group>
      )}
      <FormWizard
        steps={steps}
        onComplete={form.handleSubmit((d) => postService.mutateAsync(d))}
        loading={postService.isPending}
        onCancel={() => {
          clearDraft();
          router.navigate({ to: '/services' });
        }}
      />
    </FormProvider>
  );
};

function RouteComponent() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t('info.add.title', { name: t('services.singular') })}
      />
      <ServiceAddForm />
    </>
  );
}

export const Route = createFileRoute('/services/add')({
  component: RouteComponent,
});
