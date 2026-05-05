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
import { Tabs } from '@mantine/core';
import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/page/PageHeader';
import IconCredential from '~icons/material-symbols/key-outline';
import IconConsumer from '~icons/material-symbols/person-outline';

function RouteComponent() {
  const { t } = useTranslation();
  const { username } = useParams({ strict: false });
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const activeTab = pathname.includes('credentials') ? 'credentials' : 'detail';

  return (
    <>
      <PageHeader
        title={`${t('consumers.singular')}: ${username}`}
      />
      <Tabs
        value={activeTab}
        onChange={(v) => {
          navigate({
            to: v === 'credentials'
              ? '/consumers/detail/$username/credentials'
              : '/consumers/detail/$username',
            params: { username: username as string },
          });
        }}
        mb="md"
      >
        <Tabs.List>
          <Tabs.Tab value="detail" leftSection={<IconConsumer width="16" height="16" />}>
            {t('info.detail.title', { name: t('consumers.singular') })}
          </Tabs.Tab>
          <Tabs.Tab value="credentials" leftSection={<IconCredential width="16" height="16" />}>
            {t('sources.credentials')}
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/consumers/detail/$username')({
  component: RouteComponent,
});
