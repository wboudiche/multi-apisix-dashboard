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

import { Alert, Button, Group } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { instancesAtom } from '@/stores/instance';
import { proxyErrorAtom } from '@/stores/proxyError';
import IconError from '~icons/material-symbols/error-outline';
import IconRefresh from '~icons/material-symbols/refresh';
import IconSettings from '~icons/material-symbols/settings-outline';

export const ProxyErrorBanner = () => {
  const { t } = useTranslation();
  const [err, setErr] = useAtom(proxyErrorAtom);
  const instances = useAtomValue(instancesAtom);
  const queryClient = useQueryClient();

  const instanceName = useMemo(
    () => instances.find((i) => i.id === err?.instanceId)?.name || err?.instanceId || '',
    [instances, err]
  );

  if (!err) return null;

  return (
    <Alert
      icon={<IconError width="18" height="18" />}
      title={t('proxyError.title', { name: instanceName })}
      color="red"
      variant="light"
      mb="md"
      withCloseButton
      onClose={() => setErr(null)}
    >
      <Group justify="space-between" align="flex-start" gap="md">
        <span>
          {err.message
            ? t('proxyError.messageWithDetail', { detail: err.message })
            : t('proxyError.message')}
        </span>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconRefresh width="14" height="14" />}
            onClick={() => {
              setErr(null);
              queryClient.invalidateQueries();
            }}
          >
            {t('proxyError.retry')}
          </Button>
          <Button
            size="compact-sm"
            variant="light"
            color="gray"
            component={Link}
            to="/instances"
            leftSection={<IconSettings width="14" height="14" />}
          >
            {t('proxyError.editInstance')}
          </Button>
        </Group>
      </Group>
    </Alert>
  );
};
