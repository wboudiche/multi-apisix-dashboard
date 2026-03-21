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
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBoolean } from 'react-use';

import { getRouteQueryOptions } from '@/apis/hooks';
import { putRouteReq } from '@/apis/routes';
import {
  FormPartBasicWithPriority,
  FormSectionMatchRules,
  FormSectionPlugins,
  FormSectionService,
  FormSectionUpstream,
} from '@/components/form-slice/FormPartRoute';
import { RoutePreviewSummary } from '@/components/form-slice/FormPartRoute/RoutePreviewSummary';
import {
  RoutePutSchema,
  type RoutePutType,
} from '@/components/form-slice/FormPartRoute/schema';
import {
  produceRoute,
  produceVarsToForm,
} from '@/components/form-slice/FormPartRoute/util';
import { produceToUpstreamForm } from '@/components/form-slice/FormPartUpstream/util';
import { FormSectionGeneral } from '@/components/form-slice/FormSectionGeneral';
import { FormWizard } from '@/components/form-slice/FormWizard';
import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import PageHeader from '@/components/page/PageHeader';
import { RawJsonDrawer } from '@/components/page/RawJsonDrawer';
import { RouteTestDrawer } from '@/components/page/RouteTestDrawer';
import { API_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import { type APISIXType } from '@/types/schema/apisix';
import { usePermission } from '@/hooks/usePermission';
import IconCode from '~icons/material-symbols/code';
import IconPlayArrow from '~icons/material-symbols/play-arrow';

type Props = {
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
  id: string;
};

const RouteDetailForm = (props: Props) => {
  const { readOnly, setReadOnly, id } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const routeQuery = useQuery(getRouteQueryOptions(id));
  const { data: routeData, isLoading, refetch } = routeQuery;

  const form = useForm({
    resolver: zodResolver(RoutePutSchema),
    shouldUnregister: false,
    shouldFocusError: true,
    mode: 'all',
    disabled: readOnly,
  });

  useEffect(() => {
    if (routeData?.value && !isLoading) {
      const upstreamProduced = produceToUpstreamForm(
        routeData.value.upstream || {},
        routeData.value
      );
      form.reset(produceVarsToForm(upstreamProduced));
    }
  }, [routeData, form, isLoading]);

  const putRoute = useMutation({
    mutationFn: (d: RoutePutType) =>
      putRouteReq(req, produceRoute(d) as APISIXType['Route']),
    async onSuccess() {
      notifications.show({
        message: t('info.edit.success', { name: t('routes.singular') }),
        color: 'green',
      });
      await refetch();
      setReadOnly(true);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError(err: any) {
      const msg = err?.response?.data?.error_msg || err?.message || 'Failed to update route';
      setSubmitError(msg);
    },
  });

  const steps = [
    {
      label: 'Define API Information',
      description: 'Protocol, Host, Path, etc.',
      content: (
        <>
          <FormSectionGeneral readOnly />
          <FormPartBasicWithPriority />
          <FormSectionMatchRules />
        </>
      ),
      fields: ['name', 'uri', 'uris', 'methods', 'priority', 'vars'],
    },
    {
      label: 'Define Upstream',
      description: 'Target gateway configuration',
      content: (
        <>
          <FormSectionService />
          <FormSectionUpstream />
        </>
      ),
      fields: ['upstream', 'upstream_id', 'service_id'],
    },
    {
      label: 'Plugins Config',
      description: 'Add and configure plugins',
      content: <FormSectionPlugins />,
      fields: ['plugins', 'plugin_config_id'],
    },
    {
      label: 'Preview',
      description: 'Review and finish',
      content: <RoutePreviewSummary data={readOnly ? routeData?.value : undefined} />,
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
          setSubmitError(null);
          return putRoute.mutateAsync(d);
        })}
        loading={putRoute.isPending}
        onCancel={() => setReadOnly(true)}
        onBackToList={() => navigate({ to: '/routes' })}
        readOnly={readOnly}
        error={submitError}
      />
    </FormProvider>
  );
};

type RouteDetailProps = Pick<Props, 'id'> & {
  onDeleteSuccess: () => void;
};
export const RouteDetail = (props: RouteDetailProps) => {
  const { id, onDeleteSuccess } = props;
  const { t } = useTranslation();
  const [readOnly, setReadOnly] = useBoolean(true);
  const { canEdit } = usePermission();
  const [jsonDrawerOpen, setJsonDrawerOpen] = useBoolean(false);
  const [testDrawerOpen, setTestDrawerOpen] = useBoolean(false);
  const [jsonSaving, setJsonSaving] = useState(false);

  const routeQuery = useQuery(getRouteQueryOptions(id));
  const rawJson = routeQuery.data?.value ?? null;
  const routeUri = rawJson?.uri as string || (rawJson?.uris as string[])?.[0] || '/';
  const routeMethod = (rawJson?.methods as string[])?.[0] || 'GET';
  const routeHost = rawJson?.host as string || (rawJson?.hosts as string[])?.[0] || undefined;

  const handleJsonSave = useCallback(async (data: Record<string, unknown>) => {
    setJsonSaving(true);
    try {
      const body = { ...data };
      delete body.id;
      delete body.create_time;
      delete body.update_time;
      await req.put(`${API_ROUTES}/${id}`, body);
      notifications.show({
        message: t('form.json.saveSuccess'),
        color: 'green',
      });
      await routeQuery.refetch();
      setJsonDrawerOpen(false);
    } finally {
      setJsonSaving(false);
    }
  }, [id, t, routeQuery, setJsonDrawerOpen]);

  return (
    <>
      <PageHeader
        title={t('info.edit.title', { name: t('routes.singular') })}
        {...(readOnly && {
          title: t('info.detail.title', { name: t('routes.singular') }),
          extra: (
            <Group>
              <Button
                onClick={() => setTestDrawerOpen(true)}
                size="compact-sm"
                variant="light"
                color="blue"
                leftSection={<IconPlayArrow width="16" height="16" />}
              >
                {t('form.routeTest.title')}
              </Button>
              <Button
                onClick={() => setJsonDrawerOpen(true)}
                size="compact-sm"
                variant="light"
                color="gray"
                leftSection={<IconCode width="16" height="16" />}
              >
                {t('form.json.viewRaw')}
              </Button>
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
                name={t('routes.singular')}
                target={id}
                api={`${API_ROUTES}/${id}`}
                onSuccess={onDeleteSuccess}
              />
            </Group>
          ),
        })}
      />
      <RouteDetailForm readOnly={readOnly} setReadOnly={setReadOnly} id={id} />
      <RawJsonDrawer
        opened={jsonDrawerOpen}
        onClose={() => setJsonDrawerOpen(false)}
        title={canEdit ? t('form.json.editRaw') : t('form.json.viewRaw')}
        json={rawJson}
        onSave={canEdit ? handleJsonSave : undefined}
        loading={jsonSaving}
      />
      <RouteTestDrawer
        opened={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        defaultPath={routeUri}
        defaultMethod={routeMethod}
        defaultHost={routeHost}
      />
    </>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/routes/detail/$id' });
  const navigate = useNavigate();
  return (
    <RouteDetail id={id} onDeleteSuccess={() => navigate({ to: '/routes' })} />
  );
}

export const Route = createFileRoute('/routes/detail/$id')({
  component: RouteComponent,
});
