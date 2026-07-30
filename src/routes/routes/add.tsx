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
import { Alert, Badge, Button, Group, List, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { getRouteListReq, postRouteReq } from '@/apis/routes';
import {
  FormPartBasicWithPriority,
  FormSectionMatchRules,
  FormSectionPlugins,
  FormSectionRequestOverride,
} from '@/components/form-slice/FormPartRoute';
import { MatchPreview } from '@/components/form-slice/FormPartRoute/MatchPreview';
import { RoutePreviewSummary } from '@/components/form-slice/FormPartRoute/RoutePreviewSummary';
import {
  RoutePostSchema,
  type RoutePostType,
} from '@/components/form-slice/FormPartRoute/schema';
import { UpstreamModeSelector } from '@/components/form-slice/FormPartRoute/UpstreamModeSelector';
import { useDuplicateRouteCheck } from '@/components/form-slice/FormPartRoute/useDuplicateRouteCheck';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { FormWizard } from '@/components/form-slice/FormWizard';
import PageHeader from '@/components/page/PageHeader';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import { useFormDraftAutoSave } from '@/hooks/useFormDraftAutoSave';
import type { APISIXType } from '@/types/schema/apisix';
import {
  type ComparableRoute,
  findRouteDuplicates,
  type RouteDuplicate,
} from '@/utils/route-duplicates';
import IconWarning from '~icons/material-symbols/warning-outline';

const DRAFT_KEY = 'apisix-route-draft';

type Props = {
  navigate: (res: APISIXType['RespRouteDetail']) => Promise<void>;
  defaultValues?: Partial<RoutePostType>;
};

// [Feature 9] Duplicate route warning component
const DuplicateRouteWarning = () => {
  const { t } = useTranslation();
  const { isDuplicate, duplicates } = useDuplicateRouteCheck();
  if (!isDuplicate) return null;
  return (
    <Alert variant="light" color="yellow" icon={<IconWarning width="16" height="16" />} mb="sm">
      {duplicates.map((d) => (
        <Text key={d.id} size="sm">
          {t('form.routes.duplicateWarning', { name: d.name, uri: d.uri })}
        </Text>
      ))}
    </Alert>
  );
};

// [Feature 12] Plugin count badge step label
const PluginStepLabel = () => {
  const { t } = useTranslation();
  const plugins = useWatch({ name: 'plugins' });
  const count = plugins ? Object.keys(plugins).length : 0;
  return (
    <Group gap={6}>
      <span>{t('form.plugins.label')}</span>
      {count > 0 && (
        <Badge size="sm" circle color="var(--brand)">
          {count}
        </Badge>
      )}
    </Group>
  );
};

export const RouteAddForm = (props: Props) => {
  const { navigate, defaultValues } = props;
  const { t } = useTranslation();
  const nav = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const draftNotifiedRef = useRef(false);

  // [Feature 11] Draft auto-save and restore
  //
  // A lazy state initializer rather than a ref written during render: the draft
  // is read once at mount and then used to seed defaultValues and to decide
  // whether to offer "discard draft", both of which happen while rendering.
  // Reading a ref there is what react-hooks/refs objects to, and it can leave
  // the component not re-rendering when the value appears.
  const [savedDraft, setSavedDraft] = useState<Partial<RoutePostType> | undefined>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? (JSON.parse(saved) as Partial<RoutePostType>) : undefined;
    } catch {
      return undefined;
    }
  });

  const form = useForm<RoutePostType>({
    resolver: zodResolver(RoutePostSchema),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    defaultValues: (savedDraft as RoutePostType) || defaultValues,
  });

  const { clearDraft } = useFormDraftAutoSave(DRAFT_KEY, form);

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

  // A clash is legal in APISIX — it resolves by priority and `vars` — so the
  // operator confirms rather than being blocked. It has to be confirmed at
  // submit: the step-1 banner alone was scrolled past, which is how identical
  // routes got created without anyone noticing.
  //
  // The check runs here against freshly fetched routes rather than through
  // useDuplicateRouteCheck, which needs the form context this component only
  // renders. Asking at submit is also more truthful than a debounced watch.
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    data: RoutePostType;
    duplicates: RouteDuplicate[];
  } | null>(null);

  const checkDuplicates = useCallback(async (d: RoutePostType): Promise<RouteDuplicate[]> => {
    try {
      const existing = await getRouteListReq(req, { page: 1, page_size: PAGE_SIZE_MAX });
      return findRouteDuplicates(
        existing.list.map((r) => r.value as ComparableRoute),
        d as ComparableRoute
      );
    } catch {
      // Could not read the list: let the save proceed rather than block on a
      // check that is advisory anyway.
      return [];
    }
  }, []);

  const postRoute = useMutation({
    mutationFn: (d: RoutePostType) => postRouteReq(req, produceRoute(d)),
    async onSuccess(res) {
      clearDraft();
      notifications.show({
        message: t('info.add.success', { name: t('routes.singular') }),
        color: 'green',
      });
      await navigate(res);
    },
    // [Feature 8] Error handling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError(err: any) {
      const msg = err?.response?.data?.error_msg || err?.message || 'Failed to create route';
      setSubmitError(msg);
    },
  });

  const steps = [
    {
      label: 'Define API Information',
      description: 'Protocol, Host, Path, etc.',
      content: (
        <>
          {/* [Feature 7] Live URI/Methods preview */}
          <MatchPreview />
          {/* [Feature 9] Duplicate route detection */}
          <DuplicateRouteWarning />
          <FormPartBasicWithPriority />
          <FormSectionMatchRules />
        </>
      ),
      fields: ['name', 'uri', 'uris', 'methods', 'priority', 'vars'],
      // [Feature 4] Step summary
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSummary: (values: Record<string, any>) => {
        const methods = values.methods?.length ? values.methods.join(', ') : 'ALL';
        const uri = values.uri || values.uris?.[0] || '';
        return uri ? `${methods} ${uri}` : null;
      },
    },
    {
      label: 'Define Upstream',
      description: 'Target gateway configuration',
      content: <UpstreamModeSelector />,
      fields: ['upstream', 'upstream_id', 'service_id'],
      // [Feature 4] Step summary
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSummary: (values: Record<string, any>) => {
        if (values.service_id && values.service_id !== 'none') return 'Bound to service';
        if (values.upstream_id === 'custom') {
          const nodes = values.upstream?.nodes;
          return nodes?.length ? `Custom: ${nodes.length} node(s)` : 'Custom upstream';
        }
        if (values.upstream_id) return 'Existing upstream';
        return null;
      },
    },
    {
      label: t('form.requestOverride.title'),
      description: t('form.requestOverride.description'),
      content: <FormSectionRequestOverride />,
      fields: [],
    },
    {
      // [Feature 12] Plugin count badge
      label: <PluginStepLabel />,
      description: 'Add and configure plugins',
      content: <FormSectionPlugins />,
      fields: ['plugins', 'plugin_config_id'],
      // [Feature 4] Step summary
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSummary: (values: Record<string, any>) => {
        const count = values.plugins ? Object.keys(values.plugins).length : 0;
        if (values.plugin_config_id) return `Plugin config: ${values.plugin_config_id}`;
        return count > 0 ? `${count} plugin(s)` : null;
      },
    },
    {
      label: 'Preview',
      description: 'Review and finish',
      // [Feature 1] Structured preview
      content: <RoutePreviewSummary />,
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
              form.reset(defaultValues as RoutePostType);
              setSavedDraft(undefined);
            }}
          >
            {t('form.draft.discard')}
          </Button>
        </Group>
      )}
      <FormWizard
        steps={steps}
        onComplete={form.handleSubmit(async (d) => {
          setSubmitError(null);
          const duplicates = await checkDuplicates(d);
          if (duplicates.length > 0) {
            setPendingDuplicate({ data: d, duplicates });
            return;
          }
          await postRoute.mutateAsync(d);
        })}
        loading={postRoute.isPending}
        onCancel={() => nav({ to: '/routes' })}
        error={submitError}
      />
      <Modal
        opened={pendingDuplicate !== null}
        onClose={() => setPendingDuplicate(null)}
        title={t('form.routes.duplicateConfirmTitle')}
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm">{t('form.routes.duplicateConfirmBody')}</Text>
          <List size="sm" spacing={4} withPadding>
            {(pendingDuplicate?.duplicates ?? []).map((d) => (
              <List.Item key={`${d.id}-${d.reasons.join()}`}>
                {t(
                  d.reasons.includes('name') && d.reasons.includes('path')
                    ? 'form.routes.duplicateReasonBoth'
                    : d.reasons.includes('name')
                      ? 'form.routes.duplicateReasonName'
                      : 'form.routes.duplicateReasonPath',
                  { name: d.name, uri: d.uri }
                )}
              </List.Item>
            ))}
          </List>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setPendingDuplicate(null)}>
              {t('form.btn.cancel')}
            </Button>
            <Button
              color="yellow"
              loading={postRoute.isPending}
              onClick={() => {
                const pending = pendingDuplicate;
                setPendingDuplicate(null);
                if (pending) postRoute.mutateAsync(pending.data);
              }}
            >
              {t('form.routes.duplicateConfirmAction')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </FormProvider>
  );
};

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title={t('info.add.title', { name: t('routes.singular') })} />
      <RouteAddForm
        defaultValues={{
          uri: '/*',
          status: 1,
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          upstream_id: 'custom',
          upstream: {
            type: 'roundrobin',
            scheme: 'http',
            nodes: [],
            timeout: { connect: 6, send: 6, read: 6 },
          },
          plugins: {},
        }}
        navigate={() =>
          navigate({
            to: '/routes',
          })
        }
      />
    </>
  );
}

export const Route = createFileRoute('/routes/add')({
  component: RouteComponent,
});
