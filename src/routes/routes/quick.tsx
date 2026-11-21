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
import { Center, Loader } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { getRouteQueryOptions } from '@/apis/hooks';
import PageHeader from '@/components/page/PageHeader';
import { QuickRouteForm } from '@/components/page/QuickRouteForm';

/**
 * The quick route, on a page of its own: `?from=<id>` duplicates that route.
 */
function RouteComponent() {
  const { t } = useTranslation();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const queryClient = useQueryClient();
  const source = useQuery({ ...getRouteQueryOptions(from ?? ''), enabled: !!from });

  // Back to the list it was opened from - the routes, or a service's - and to
  // the routes when the page was opened on its own. The lists read again, so
  // a route just made is on them.
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['routes'] });
    if (canGoBack) router.history.back();
    else void navigate({ to: '/routes' });
  };

  if (from && !source.data) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  const route = source.data?.value;
  return (
    <>
      <PageHeader
        title={route ? t('form.quickRoute.duplicateTitle', { name: route.name || route.id }) : t('form.quickRoute.title')}
      />
      {/* Keyed by the route: the form starts from the one it copies. */}
      <QuickRouteForm key={route?.id ?? 'new'} source={route} onDone={done} />
    </>
  );
}

export const Route = createFileRoute('/routes/quick')({
  component: RouteComponent,
  validateSearch: z.object({ from: z.string().optional() }),
});
