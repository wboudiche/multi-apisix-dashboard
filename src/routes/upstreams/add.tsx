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
import { FormProvider, type Resolver, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { postUpstreamReq } from '@/apis/upstreams';
import { FormPartBasic } from '@/components/form-slice/FormPartBasic';
import {
  FormSectionChecks,
  FormSectionConnection,
  FormSectionNodesAndDiscovery,
} from '@/components/form-slice/FormPartUpstream';
import { FormPartUpstreamSchema } from '@/components/form-slice/FormPartUpstream/schema';
import { UpstreamPreviewSummary } from '@/components/form-slice/FormPartUpstream/UpstreamPreviewSummary';
import { FormWizard } from '@/components/form-slice/FormWizard';
import PageHeader from '@/components/page/PageHeader';
import { req } from '@/config/req';
import { useFormDraftAutoSave } from '@/hooks/useFormDraftAutoSave';
import { APISIX } from '@/types/schema/apisix';
import { pipeProduce } from '@/utils/producer';

const DRAFT_KEY = 'apisix-upstream-draft';

const PostUpstreamSchema = FormPartUpstreamSchema.omit({
  id: true,
}).extend({
  name: z.string().min(1, 'Name is required'),
  nodes: z.array(APISIX.UpstreamNode).min(1, 'At least one node is required'),
});

type PostUpstreamType = z.infer<typeof PostUpstreamSchema>;

const defaultValues: Partial<PostUpstreamType> = {
  nodes: [],
};

const UpstreamAddFormBody = ({ onDraftDiscarded }: { onDraftDiscarded: () => void }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const draftNotifiedRef = useRef(false);

  // Read once at mount, as on the route add page: a ref read while rendering
  // is what react-hooks/refs objects to.
  const [savedDraft] = useState<Partial<PostUpstreamType> | undefined>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? (JSON.parse(saved) as Partial<PostUpstreamType>) : undefined;
    } catch {
      return undefined;
    }
  });

  const form = useForm<PostUpstreamType>({
    resolver: zodResolver(PostUpstreamSchema) as unknown as Resolver<PostUpstreamType>,
    shouldUnregister: false,
    mode: 'all',
    defaultValues: savedDraft || defaultValues,
  });

  const { clearDraft } = useFormDraftAutoSave(DRAFT_KEY, form);

  const postUpstream = useMutation({
    mutationFn: (d: PostUpstreamType) => postUpstreamReq(req, d),
    async onSuccess() {
      clearDraft();
      notifications.show({
        message: t('info.add.success', { name: t('upstreams.singular') }),
        color: 'green',
      });
      await router.navigate({ to: '/upstreams' });
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
      label: t('form.upstreams.steps.basic'),
      description: t('form.upstreams.steps.basicDesc'),
      content: <FormPartBasic />,
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
      content: <UpstreamPreviewSummary />,
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
            // Discarding remounts the form, which would drop a submit in flight.
            disabled={postUpstream.isPending}
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
        onComplete={form.handleSubmit((d) => postUpstream.mutateAsync(pipeProduce()(d)))}
        loading={postUpstream.isPending}
        onCancel={() => {
          clearDraft();
          router.navigate({ to: '/upstreams' });
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
const UpstreamAddForm = () => {
  const [formKey, setFormKey] = useState(0);
  return <UpstreamAddFormBody key={formKey} onDraftDiscarded={() => setFormKey((k) => k + 1)} />;
};

function RouteComponent() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t('info.add.title', { name: t('upstreams.singular') })}
      />
      <UpstreamAddForm />
    </>
  );
}

export const Route = createFileRoute('/upstreams/add')({
  component: RouteComponent,
});
