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
  FormPartRouteBasic,
  FormSectionMatchRules,
  FormSectionPlugins,
  FormSectionRequestOverride,
  FormSectionService,
  FormSectionUpstream,
} from '@/components/form-slice/FormPartRoute';
import { RoutePreviewSummary } from '@/components/form-slice/FormPartRoute/RoutePreviewSummary';
import {
  type RoutePostType,
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
import { DetailGate } from '@/components/page/DetailGate';
import PageHeader from '@/components/page/PageHeader';
import { RawJsonDrawer } from '@/components/page/RawJsonDrawer';
import { ReassignTeamModal } from '@/components/page/ReassignTeamModal';
import { RouteTestDrawer } from '@/components/page/RouteTestDrawer';
import { API_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { type APISIXType } from '@/types/schema/apisix';
import { extractSoapAction } from '@/utils/soap-route';
import { proxyFailureText } from '@/utils/team-refusal';
import IconCode from '~icons/material-symbols/code';
import IconGroup from '~icons/material-symbols/group';
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

  const form = useForm<RoutePutType>({
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
        routeData.value as APISIXType['Route']
      );
      form.reset(produceVarsToForm(upstreamProduced as RoutePostType) as RoutePutType);
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
      const msg = proxyFailureText(err) || t('routes.updateFailed');
      setSubmitError(msg);
    },
  });

  const steps = [
    {
      label: t('form.routes.steps.apiInfo'),
      content: (
        <>
          <FormSectionGeneral readOnly />
          <FormPartRouteBasic />
          <FormSectionMatchRules />
        </>
      ),
      // Every field the step holds: one left out is one a Submit from a later
      // step would find refused with nothing on screen to say so.
      fields: ['name', 'desc', 'labels', 'status', 'methods', 'uri', 'host', 'enable_websocket', 'uris', 'hosts', 'remote_addr', 'remote_addrs', 'vars', 'filter_func', 'priority'],
    },
    {
      label: t('form.routes.steps.upstream'),
      content: (
        <>
          <FormSectionService />
          <FormSectionUpstream />
        </>
      ),
      fields: ['upstream', 'upstream_id', 'service_id'],
    },
    {
      // Request rewrite and plugins, one step, as on the add page.
      label: t('form.routes.steps.options'),
      content: (
        <>
          <FormSectionRequestOverride />
          <FormSectionPlugins />
        </>
      ),
      fields: ['plugins', 'plugin_config_id'],
    },
    {
      label: t('form.routes.steps.preview'),
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
  const { isAdmin, canWriteResource, canWriteOwner } = usePermission();
  // The backend keeps the route test for those who can write routes on the
  const [jsonDrawerOpen, setJsonDrawerOpen] = useBoolean(false);
  const [testDrawerOpen, setTestDrawerOpen] = useBoolean(false);
  const [reassignOpen, setReassignOpen] = useBoolean(false);
  const [jsonSaving, setJsonSaving] = useState(false);

  const routeQuery = useQuery(getRouteQueryOptions(id));
  const rawJson = routeQuery.data?.value ?? null;
  const routeUri = rawJson?.uri as string || (rawJson?.uris as string[])?.[0] || '/';
  const routeMethod = (rawJson?.methods as string[])?.[0] || 'GET';
  const routeHost = rawJson?.host as string || (rawJson?.hosts as string[])?.[0] || undefined;
  const routeSoapAction = extractSoapAction(rawJson?.vars);
  const currentTeamId = (rawJson as Record<string, unknown> | null)?.__team_id as string | undefined;
  // The role that counts is the one in the route's team, not the instance's.
  const canChange = canWriteOwner(currentTeamId);
  // The backend keeps the route test for those who can write routes on the
  // instance, and are developer in the route's team: it sends a request of any
  // method through the gateway (#307).
  const canTest = canWriteResource('routes') && canChange;

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
              {canTest && (
                <Button
                  onClick={() => setTestDrawerOpen(true)}
                  size="compact-sm"
                  variant="light"
                  color="blue"
                  leftSection={<IconPlayArrow width="16" height="16" />}
                >
                  {t('form.routeTest.title')}
                </Button>
              )}
              <Button
                onClick={() => setJsonDrawerOpen(true)}
                size="compact-sm"
                variant="light"
                color="gray"
                leftSection={<IconCode width="16" height="16" />}
              >
                {t('form.json.viewRaw')}
              </Button>
              {isAdmin && (
                <Button
                  onClick={() => setReassignOpen(true)}
                  size="compact-sm"
                  variant="light"
                  color="teal"
                  leftSection={<IconGroup width="16" height="16" />}
                >
                  {t('form.reassignTeam.title')}
                </Button>
              )}
              {canChange && (
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
                allowed={canChange}
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
        title={canChange ? t('form.json.editRaw') : t('form.json.viewRaw')}
        json={rawJson}
        onSave={canChange ? handleJsonSave : undefined}
        loading={jsonSaving}
      />
      <RouteTestDrawer
        opened={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        routeId={id}
        defaultPath={routeUri}
        defaultMethod={routeMethod}
        defaultHost={routeHost}
        defaultSoapAction={routeSoapAction}
      />
      <ReassignTeamModal
        opened={reassignOpen}
        onClose={() => setReassignOpen(false)}
        onSaved={() => routeQuery.refetch()}
        resourceType="routes"
        resourceId={id}
        currentTeamId={currentTeamId}
      />
    </>
  );
};

function RouteComponent() {
  const { id } = useParams({ from: '/routes/detail/$id' });
  const navigate = useNavigate();
  return (
    <DetailGate
      record={() => getRouteQueryOptions(id)}
      id={id}
      onBack={() => navigate({ to: '/routes' })}
    >
      <RouteDetail id={id} onDeleteSuccess={() => navigate({ to: '/routes' })} />
    </DetailGate>
  );
}

export const Route = createFileRoute('/routes/detail/$id')({
  component: RouteComponent,
});
