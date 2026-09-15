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
import { useEffect, useRef, useState } from 'react';
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
import { produceServiceBody } from '@/utils/service-body';

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

const ServiceAddFormBody = ({ onDraftDiscarded }: { onDraftDiscarded: () => void }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const draftNotifiedRef = useRef(false);

  // Read once at mount, as on the route add page: a ref read while rendering
  // is what react-hooks/refs objects to.
  const [savedDraft] = useState<Partial<ServicePostType> | undefined>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? (JSON.parse(saved) as Partial<ServicePostType>) : undefined;
    } catch {
      return undefined;
    }
  });

  const form = useForm({
    resolver: zodResolver(ServicePostSchema),
    defaultValues: savedDraft || defaultValues,
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'onTouched',
  });

  const { clearDraft } = useFormDraftAutoSave(DRAFT_KEY, form);

  const postService = useMutation({
    mutationFn: (d: ServicePostType) =>
      postServiceReq(req, produceServiceBody(d)),
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
    if (savedDraft && !draftNotifiedRef.current) {
      draftNotifiedRef.current = true;
      notifications.show({
        message: t('form.draft.restored'),
        color: 'blue',
        autoClose: 5000,
      });
    }
  }, [t, savedDraft]);

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
      {savedDraft && (
        <Group justify="flex-end" mb="xs">
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            onClick={() => {
              clearDraft();
              onDraftDiscarded();
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

// Discard Draft remounts the form rather than resetting it. react-hook-form's
// useController falls back to the default it took at mount, which was the
// draft's, so after a reset every field the draft had and the page's defaults
// lack kept showing the draft (#224). The draft is out of storage by then, so
// the new form starts from the page's defaults.
const ServiceAddForm = () => {
  const [formKey, setFormKey] = useState(0);
  return <ServiceAddFormBody key={formKey} onDraftDiscarded={() => setFormKey((k) => k + 1)} />;
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
