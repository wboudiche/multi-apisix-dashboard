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
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Modal,
  MultiSelect,
  Paper,
  PasswordInput,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type IdentityProvider, idpApi, testFailureKey } from '@/apis/idps';
import { instanceApi } from '@/apis/instances';
import { describeError } from '@/utils/api-error';
import IconPlus from '~icons/material-symbols/add';
import IconEdit from '~icons/material-symbols/edit-outline';

import { emptyIdpForm, formFromIdp, type IdpFormState, inputFromForm } from './idp-form';

const IDPS_KEY = ['idps'];

/** The connection being deleted, and the backend's reason once it refused. */
type Deleting = { idp: IdentityProvider; refusal?: string };

export const IdentityProvidersTab = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: idps = [], isError } = useQuery({ queryKey: IDPS_KEY, queryFn: idpApi.list });
  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: instanceApi.list,
  });

  // null while closed; the connection's id while editing it, '' while adding.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IdpFormState>(emptyIdpForm());
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const instanceName = (id: string) => instances.find((i) => i.id === id)?.name ?? id;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: IDPS_KEY });
    // What the route form offers is read from the same connections.
    queryClient.invalidateQueries({ queryKey: ['idps', 'linked'] });
  };
  const patch = (changes: Partial<IdpFormState>) => setForm((f) => ({ ...f, ...changes }));

  const open = (idp?: IdentityProvider) => {
    setForm(idp ? formFromIdp(idp) : emptyIdpForm());
    setEditingId(idp?.id ?? '');
  };
  const close = () => setEditingId(null);

  const save = useMutation({
    mutationFn: () => {
      const input = inputFromForm(form);
      return editingId ? idpApi.update(editingId, input) : idpApi.create(input);
    },
    onSuccess: () => {
      notifications.show({
        message: editingId ? t('settings.idp.updated') : t('settings.idp.created'),
        color: 'green',
      });
      close();
      refresh();
    },
    // The backend says why it refused (a malformed address, a secret to enter
    // again, clients that depend on the realm): that is the message.
    onError: (error) =>
      notifications.show({ message: describeError(error, t('settings.idp.saveFailed')), color: 'red' }),
  });

  const test = useMutation({
    mutationFn: idpApi.test,
    onSuccess: (result) =>
      notifications.show(
        result.ok
          ? { message: t('settings.idp.test.ok'), color: 'green' }
          : {
              // eslint-disable-next-line local/readable-key -- the three keys are spelled in testFailureKey (src/apis/idps.ts)
              message: t(testFailureKey(result.reason)),
              color: 'red',
            }
      ),
    onError: () => notifications.show({ message: t('settings.idp.test.failed'), color: 'red' }),
  });

  const remove = useMutation({
    mutationFn: ({ idp, force }: { idp: IdentityProvider; force: boolean }) =>
      idpApi.remove(idp.id, force),
    onSuccess: () => {
      notifications.show({ message: t('settings.idp.deleted'), color: 'green' });
      setDeleting(null);
      refresh();
    },
    onError: (error, { idp }) => {
      // 409: connections with clients are not deleted unless forced. Say why,
      // and offer to go ahead.
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setDeleting({ idp, refusal: describeError(error, t('settings.idp.deleteFailed')) });
        return;
      }
      notifications.show({ message: describeError(error, t('settings.idp.deleteFailed')), color: 'red' });
    },
  });

  const canSave =
    form.name.trim() !== '' &&
    form.base_url.trim() !== '' &&
    form.realm.trim() !== '' &&
    form.admin_client_id.trim() !== '' &&
    form.client_id_prefix.trim() !== '';

  const editing = editingId ? idps.find((i) => i.id === editingId) : undefined;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Text size="sm" c="dimmed" maw={640}>
          {t('settings.idp.serviceAccountHelp')}
        </Text>
        <Button leftSection={<IconPlus width="18" height="18" />} onClick={() => open()}>
          {t('settings.idp.add')}
        </Button>
      </Group>

      {isError && <Alert color="red">{t('settings.idp.loadFailed')}</Alert>}

      <Paper withBorder p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('settings.idp.column.name')}</Table.Th>
              <Table.Th>{t('settings.idp.column.urlRealm')}</Table.Th>
              <Table.Th>{t('sources.instances')}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{t('table.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {idps.map((idp) => (
              <Table.Tr key={idp.id}>
                <Table.Td>
                  <Text fw={600} size="sm">{idp.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{idp.base_url}</Text>
                  <Text size="xs" c="dimmed">{idp.realm}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{idp.instance_ids.map(instanceName).join(', ')}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Button
                      size="xs"
                      variant="light"
                      loading={test.isPending && test.variables === idp.id}
                      onClick={() => test.mutate(idp.id)}
                    >
                      {t('settings.idp.test.button')}
                    </Button>
                    <Tooltip label={t('form.btn.edit')}>
                      <ActionIcon
                        variant="light"
                        aria-label={t('form.btn.edit')}
                        onClick={() => open(idp)}
                      >
                        <IconEdit width="16" height="16" />
                      </ActionIcon>
                    </Tooltip>
                    <Button
                      size="xs"
                      color="red"
                      variant="filled"
                      onClick={() => setDeleting({ idp })}
                    >
                      {t('form.btn.delete')}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {idps.length === 0 && !isError && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Box ta="center" py="lg">
                    <Text c="dimmed">{t('settings.idp.empty')}</Text>
                  </Box>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      <Modal
        opened={editingId !== null}
        onClose={close}
        title={editingId ? t('settings.idp.editTitle') : t('settings.idp.addTitle')}
        size="lg"
      >
        <Stack gap="sm">
          <TextInput
            label={t('settings.idp.column.name')}
            value={form.name}
            onChange={(e) => patch({ name: e.currentTarget.value })}
            required
          />
          <TextInput
            label={t('settings.idp.field.baseUrl')}
            description={t('settings.idp.field.baseUrlHint')}
            // eslint-disable-next-line i18next/no-literal-string -- an example address
            placeholder="https://sso.example.com"
            value={form.base_url}
            onChange={(e) => patch({ base_url: e.currentTarget.value })}
            required
          />
          <TextInput
            label={t('settings.idp.field.realm')}
            value={form.realm}
            onChange={(e) => patch({ realm: e.currentTarget.value })}
            required
          />
          <TextInput
            label={t('settings.idp.field.adminClientId')}
            value={form.admin_client_id}
            onChange={(e) => patch({ admin_client_id: e.currentTarget.value })}
            required
          />
          <PasswordInput
            label={t('settings.idp.field.adminClientSecret')}
            description={t('settings.idp.field.secretHint')}
            placeholder={editing?.has_secret ? t('settings.idp.field.secretUnchanged') : undefined}
            autoComplete="new-password"
            value={form.admin_client_secret}
            onChange={(e) => patch({ admin_client_secret: e.currentTarget.value })}
            required={!editingId}
          />
          <TextInput
            label={t('settings.idp.field.prefix')}
            description={t('settings.idp.field.prefixHint')}
            // eslint-disable-next-line i18next/no-literal-string -- an example prefix
            placeholder="apisix-"
            value={form.client_id_prefix}
            onChange={(e) => patch({ client_id_prefix: e.currentTarget.value })}
            required
          />
          <MultiSelect
            label={t('settings.idp.field.instances')}
            data={instances.map((i) => ({ value: i.id, label: i.name }))}
            value={form.instance_ids}
            onChange={(ids) => patch({ instance_ids: ids })}
            searchable
          />
          <Switch
            label={t('settings.idp.field.developersCanCreate')}
            checked={form.developers_can_create}
            onChange={(e) => patch({ developers_can_create: e.currentTarget.checked })}
          />
          <TagsInput
            label={t('settings.idp.field.redirectDomains')}
            description={t('settings.idp.field.redirectDomainsHint')}
            // eslint-disable-next-line i18next/no-literal-string -- an example domain
            placeholder="app.example.com"
            value={form.redirect_domains}
            onChange={(domains) => patch({ redirect_domains: domains })}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={close}>
              {t('form.btn.cancel')}
            </Button>
            <Button disabled={!canSave} loading={save.isPending} onClick={() => save.mutate()}>
              {t('form.btn.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('settings.idp.deleteTitle')}
      >
        {deleting && (
          <Stack gap="md">
            {deleting.refusal ? (
              <Alert color="orange">{deleting.refusal}</Alert>
            ) : (
              <Text size="sm">
                {t('settings.idp.deleteConfirm', { name: deleting.idp.name })}
              </Text>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleting(null)}>
                {t('form.btn.cancel')}
              </Button>
              <Button
                color="red"
                loading={remove.isPending}
                onClick={() => remove.mutate({ idp: deleting.idp, force: !!deleting.refusal })}
              >
                {deleting.refusal ? t('settings.idp.deleteAnyway') : t('form.btn.delete')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
