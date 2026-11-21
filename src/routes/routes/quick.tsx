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
import { Alert, Button, Stack } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { getRouteQueryOptions } from '@/apis/hooks';
import { DetailGate } from '@/components/page/DetailGate';
import PageHeader from '@/components/page/PageHeader';
import { QuickRouteForm } from '@/components/page/QuickRouteForm';
import { currentInstanceIdAtom } from '@/stores/instance';

type Leave = { onCreated: () => void; onCancel: () => void };

/** A new route. Keyed on the instance: one picked from another is gone. */
const NewRoute = (leave: Leave) => {
  const { t } = useTranslation();
  const instanceId = useAtomValue(currentInstanceIdAtom);
  return (
    <>
      <PageHeader title={t('form.quickRoute.title')} />
      <QuickRouteForm key={instanceId} {...leave} />
    </>
  );
};

/**
 * The route to copy, read once: a refetch on coming back to the tab - one
 * that finds the route gone, or the gateway out of reach - would swap the
 * form for a message and throw away what was typed in it.
 */
const sourceQuery = (id: string) => ({
  ...getRouteQueryOptions(id),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
});

/** A copy of the route `id`, read by the gate on the instance in use. */
const DuplicateRoute = ({ id, ...leave }: Leave & { id: string }) => {
  const { t } = useTranslation();
  const { data } = useQuery(sourceQuery(id));
  // A gateway that cannot be reached answers an empty record: nothing to
  // copy, and no route to name.
  const route = data?.value?.id ? data.value : undefined;
  if (!route) {
    return (
      <Stack maw={880} align="flex-start">
        <PageHeader title={t('form.quickRoute.title')} />
        <Alert color="red" variant="light" w="100%">
          {t('proxyError.message')}
        </Alert>
        <Button variant="light" onClick={leave.onCancel}>
          {t('form.btn.backToList')}
        </Button>
      </Stack>
    );
  }
  return (
    <>
      <PageHeader title={t('form.quickRoute.duplicateTitle', { name: route.name || route.id })} />
      {/* Keyed by the route: the form starts from the one it copies. */}
      <QuickRouteForm key={route.id} source={route} {...leave} />
    </>
  );
};

/**
 * The quick route, on a page of its own: `?from=<id>` duplicates that route.
 */
function RouteComponent() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const queryClient = useQueryClient();

  // A create that settles once the page is left - by the menu, or Back -
  // takes nobody anywhere: they are already where they chose to go.
  const onPage = useRef(true);
  useEffect(() => {
    onPage.current = true;
    return () => {
      onPage.current = false;
    };
  }, []);

  // Back to the list it was opened from - the routes, or a service's - and to
  // the routes when the page was opened on its own.
  const back = () => {
    if (!onPage.current) return;
    if (canGoBack) router.history.back();
    else void navigate({ to: '/routes' });
  };
  const leave: Leave = {
    // The lists read again, so the route just made is on them.
    onCreated: () => {
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      back();
    },
    onCancel: back,
  };

  if (!from) return <NewRoute {...leave} />;
  return (
    // Keyed by the route: another one to copy is another page.
    <DetailGate key={from} record={() => sourceQuery(from)} id={from} onBack={() => void navigate({ to: '/routes' })}>
      <DuplicateRoute id={from} {...leave} />
    </DetailGate>
  );
}

export const Route = createFileRoute('/routes/quick')({
  component: RouteComponent,
  // Coerced: the router parses a value that looks like a number as one, and
  // an APISIX id often does.
  validateSearch: z.object({ from: z.coerce.string().optional() }),
});
