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
import { Alert, Badge, Box, Button, Group, Loader, Modal, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { oidcClientApi,type OidcClientItem } from '@/apis/idps';
import { useTeamNames } from '@/hooks/useTeamColumn';
import { currentInstanceIdAtom } from '@/stores/instance';
import { describeError } from '@/utils/api-error';

import { deleteConfirmKey, oidcStatusView, routesLabel, teamLabel } from './oidc-clients';

export const OidcClientsTab = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const instanceId = useAtomValue(currentInstanceIdAtom);
  const teamNames = useTeamNames();
  const [deleting, setDeleting] = useState<OidcClientItem | null>(null);

  // The instance is part of the key, so switching it in the header refetches.
  // The key starts like the picker's ['oidc-clients', instanceId], which an
  // invalidation of that prefix reaches too.
  const {
    data: clients = [],
    isError,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['oidc-clients', instanceId, 'status'],
    queryFn: () => oidcClientApi.list(instanceId, true),
    enabled: !!instanceId,
  });

  const remove = useMutation({
    mutationFn: (client: OidcClientItem) => oidcClientApi.remove(instanceId, client.uuid),
    onSuccess: () => {
      notifications.show({ message: t('settings.oidcClients.deleted'), color: 'green' });
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['oidc-clients', instanceId] });
      queryClient.invalidateQueries({ queryKey: ['idps', 'linked', instanceId] });
    },
    onError: (err) =>
      notifications.show({
        message: describeError(err, t('settings.oidcClients.deleteFailed')),
        color: 'red',
      }),
  });

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" maw={640}>
        {t('settings.oidcClients.help')}
      </Text>

      {isError && (
        <Alert color="red">{describeError(error, t('settings.oidcClients.loadFailed'))}</Alert>
      )}

      <Paper withBorder p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('settings.oidcClients.column.clientId')}</Table.Th>
              <Table.Th>{t('settings.oidcClients.column.provider')}</Table.Th>
              <Table.Th>{t('sources.routes')}</Table.Th>
              <Table.Th>{t('routes.list.headerTeam')}</Table.Th>
              <Table.Th>{t('routes.list.headerStatus')}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{t('table.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {clients.map((client) => {
              const view = oidcStatusView(client.status);
              // eslint-disable-next-line local/readable-key -- the keys are spelled in oidcStatusView (oidc-clients.ts)
              const badge = <Badge color={view.color} variant="light">{t(view.labelKey)}</Badge>;
              return (
                <Table.Tr key={client.uuid}>
                  <Table.Td>
                    <Text fw={600} size="sm">{client.client_id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{client.idp_name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{routesLabel(client.routes)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{teamLabel(client.team_id, teamNames)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {view.helpKey ? <Tooltip label={t('settings.oidcClients.status.unknownHelp')}>{badge}</Tooltip> : badge}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button size="xs" color="red" variant="filled" onClick={() => setDeleting(client)}>
                        {t('form.btn.delete')}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {isLoading && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Box ta="center" py="lg">
                    <Loader size="sm" data-testid="oidc-clients-loading" />
                  </Box>
                </Table.Td>
              </Table.Tr>
            )}
            {clients.length === 0 && !isError && !isLoading && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Box ta="center" py="lg">
                    <Text c="dimmed">{t('settings.oidcClients.empty')}</Text>
                  </Box>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('settings.oidcClients.deleteTitle')}
      >
        {deleting && (
          <Stack gap="md">
            <Text size="sm">
              {deleteConfirmKey(deleting.routes) === 'settings.oidcClients.deleteConfirmRoutes'
                ? t('settings.oidcClients.deleteConfirmRoutes', {
                    name: deleting.client_id,
                    routes: routesLabel(deleting.routes),
                  })
                : t('settings.oidcClients.deleteConfirm', { name: deleting.client_id })}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleting(null)}>
                {t('form.btn.cancel')}
              </Button>
              <Button color="red" loading={remove.isPending} onClick={() => remove.mutate(deleting)}>
                {t('form.btn.delete')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
