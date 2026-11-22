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
import { Container, Paper, Tabs, Text, Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { IdentityProvidersTab } from '@/components/page-slice/settings/IdentityProvidersTab';
import { PasswordPolicyTab } from '@/components/page-slice/settings/PasswordPolicyTab';
import { settingsTabsFor } from '@/components/page-slice/settings/tabs';
import { usePermission } from '@/hooks/usePermission';

const Settings = () => {
  const { t } = useTranslation();
  const { role, isAdmin } = usePermission();
  const tabs = settingsTabsFor(role);

  if (!isAdmin) {
    return (
      <Container size="sm">
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed">{t('settings.accessDenied')}</Text>
        </Paper>
      </Container>
    );
  }

  // An admin of the instance reaches the page for the OIDC clients of that
  // instance; until that tab exists they have nothing here.
  if (tabs.length === 0) {
    return (
      <Container size="sm">
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed">{t('settings.nothingToManage')}</Text>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size="lg">
      <Title order={2} mb="lg">{t('sources.settings')}</Title>
      <Tabs defaultValue={tabs[0]} keepMounted={false}>
        <Tabs.List mb="md">
          {tabs.includes('password-policy') && (
            <Tabs.Tab value="password-policy">{t('settings.passwordPolicy')}</Tabs.Tab>
          )}
          {tabs.includes('identity-providers') && (
            <Tabs.Tab value="identity-providers">{t('settings.idp.title')}</Tabs.Tab>
          )}
        </Tabs.List>
        {tabs.includes('password-policy') && (
          <Tabs.Panel value="password-policy">
            <Container size="sm" p={0} ml={0}>
              <PasswordPolicyTab />
            </Container>
          </Tabs.Panel>
        )}
        {tabs.includes('identity-providers') && (
          <Tabs.Panel value="identity-providers">
            <IdentityProvidersTab />
          </Tabs.Panel>
        )}
      </Tabs>
    </Container>
  );
};

export const Route = createFileRoute('/settings/')({
  component: Settings,
});
