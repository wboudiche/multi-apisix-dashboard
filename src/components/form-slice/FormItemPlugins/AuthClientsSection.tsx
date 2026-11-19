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
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { putConsumerReq } from '@/apis/consumers';
import { getCredentialListReq, putCredentialReq } from '@/apis/credentials';
import { API_CONSUMERS } from '@/config/constant';
import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { currentInstanceIdAtom } from '@/stores/instance';
import type { APISIXType } from '@/types/schema/apisix';
import {
  type AuthClientPlugin,
  CLIENT_NAME_PATTERN,
  credentialConfig,
  credentialId,
  generateSecret,
  holdsCredential,
} from '@/utils/auth-clients';
import IconAdd from '~icons/material-symbols/add';
import IconCheck from '~icons/material-symbols/check';
import IconCopy from '~icons/material-symbols/content-copy-outline';
import IconRefresh from '~icons/material-symbols/refresh';

type Clients = { holders: string[]; all: string[] };

// Every consumer of the gateway, with what each holds. APISIX lists a
// consumer's credentials separately, so this is one request per consumer:
// fine for the tens a gateway has, and only asked for while the form is open.
const fetchClients = async (plugin: AuthClientPlugin): Promise<Clients> => {
  const consumers = await req
    // No page asked for: the gateway then answers with every consumer.
    .get<unknown, APISIXType['RespConsumerList']>(API_CONSUMERS)
    .then((v) => v.data.list.map((item) => item.value));
  const holders = await Promise.all(
    consumers.map(async (consumer) => {
      if (holdsCredential(plugin, consumer, [])) return consumer.username;
      const creds = await getCredentialListReq(req, { username: consumer.username });
      return holdsCredential(
        plugin,
        consumer,
        creds.list.map((item) => item.value)
      )
        ? consumer.username
        : undefined;
    })
  );
  return {
    holders: holders.filter((n): n is string => !!n).sort(),
    all: consumers.map((c) => c.username),
  };
};

const CopyValue = ({ value }: { value: string }) => {
  const { t } = useTranslation();
  return (
    <CopyButton value={value}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? t('form.json.copied') : t('form.json.copy')}>
          <ActionIcon
            variant="subtle"
            color={copied ? 'teal' : 'gray'}
            onClick={copy}
            aria-label={t('form.json.copy')}
          >
            {copied ? <IconCheck /> : <IconCopy />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
};

type Created = { name: string; secret: string };

/** How a caller presents what it was given, for the plugin's settings. */
const Usage = ({
  plugin,
  config,
  created,
}: {
  plugin: AuthClientPlugin;
  config: Record<string, unknown>;
  created: Created;
}) => {
  const header = typeof config.header === 'string' && config.header ? config.header : 'apikey';
  const line =
    plugin === 'key-auth'
      ? `curl -H '${header}: ${created.secret}' http://<gateway>/<path>`
      : `curl -u '${created.name}:${created.secret}' http://<gateway>/<path>`;
  return (
    <Group gap={4} wrap="nowrap" align="flex-start">
      <Code block style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {line}
      </Code>
      <CopyValue value={line} />
    </Group>
  );
};

export type AuthClientsSectionProps = {
  plugin: AuthClientPlugin;
  /** The plugin's configuration as edited, for the header a key goes in. */
  config: Record<string, unknown>;
};

/**
 * Who can get through the plugin, and a way to let one more in, in the
 * plugin's own form: the consumers holding a credential of it, and a new one
 * made from a name with its secret generated.
 */
export const AuthClientsSection = ({ plugin, config }: AuthClientsSectionProps) => {
  const { t } = useTranslation();
  const instanceId = useAtomValue(currentInstanceIdAtom);
  const { canCreate, canWriteResource } = usePermission();
  const mayCreate = canCreate && canWriteResource('consumers');

  const clients = useQuery({
    queryKey: ['auth-clients', instanceId, plugin],
    queryFn: () => fetchClients(plugin),
  });

  const [formOpened, setFormOpened] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState(() => generateSecret());
  const [created, setCreated] = useState<Created>();

  const nameTaken = !!clients.data?.holders.includes(name);
  const nameError =
    name && !CLIENT_NAME_PATTERN.test(name)
      ? t('form.plugins.clients.nameInvalid')
      : nameTaken
        ? t('form.plugins.clients.nameTaken')
        : undefined;

  const create = useMutation({
    mutationFn: async () => {
      // A consumer that exists already keeps what it has: a PUT of the
      // consumer would replace its plugins, so only the credential is added.
      if (!clients.data?.all.includes(name)) {
        await putConsumerReq(req, { username: name } as APISIXType['ConsumerPut']);
      }
      await putCredentialReq(req, {
        username: name,
        id: credentialId(plugin),
        plugins: { [plugin]: credentialConfig(plugin, name, secret) },
      } as APISIXType['CredentialPut'] & { username: string });
    },
    onSuccess: () => {
      setCreated({ name, secret });
      setFormOpened(false);
      setName('');
      setSecret(generateSecret());
      void queryClient.invalidateQueries({ queryKey: ['auth-clients', instanceId] });
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'consumers',
      });
    },
  });

  const secretLabel =
    plugin === 'key-auth'
      ? t('form.plugins.clients.key')
      : t('form.plugins.clients.password');

  return (
    <Paper withBorder radius="md" p="md" mt="md" data-testid="auth-clients">
      <Stack gap="sm">
        <div>
          <Title order={5}>{t('form.plugins.clients.title')}</Title>
          <Text size="sm" c="dimmed">
            {plugin === 'key-auth'
              ? t('form.plugins.clients.descKey')
              : t('form.plugins.clients.descBasic')}
          </Text>
        </div>

        {clients.isPending && <Loader size="sm" />}
        {clients.isError && (
          <Alert color="red" variant="light">
            {t('form.plugins.clients.loadFailed')}
          </Alert>
        )}
        {clients.data &&
          (clients.data.holders.length === 0 ? (
            <Alert color="yellow" variant="light">
              {t('form.plugins.clients.none')}
            </Alert>
          ) : (
            <Group gap="xs">
              {clients.data.holders.map((holder) => (
                <Badge key={holder} variant="light" color="gray" size="lg" tt="none">
                  {holder}
                </Badge>
              ))}
            </Group>
          ))}

        {created && (
          <Alert color="teal" variant="light" withCloseButton onClose={() => setCreated(undefined)}>
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {plugin === 'key-auth'
                  ? t('form.plugins.clients.createdKey', { name: created.name })
                  : t('form.plugins.clients.createdPassword', { name: created.name })}
              </Text>
              <Group gap={4} wrap="nowrap">
                <Code style={{ flex: 1 }}>{created.secret}</Code>
                <CopyValue value={created.secret} />
              </Group>
              <Text size="xs" c="dimmed">
                {t('form.plugins.clients.tryIt')}
              </Text>
              <Usage plugin={plugin} config={config} created={created} />
            </Stack>
          </Alert>
        )}

        {mayCreate && !formOpened && (
          <Button
            variant="light"
            w="fit-content"
            leftSection={<IconAdd />}
            onClick={() => setFormOpened(true)}
          >
            {t('form.plugins.clients.newClient')}
          </Button>
        )}

        {mayCreate && formOpened && (
          <>
            <Divider />
            <TextInput
              label={t('form.plugins.clients.name')}
              description={t('form.plugins.clients.nameHelp')}
              value={name}
              onChange={(e) => setName(e.currentTarget.value.trim())}
              error={nameError}
              data-autofocus
            />
            <TextInput
              label={secretLabel}
              description={t('form.plugins.clients.secretHelp')}
              value={secret}
              onChange={(e) => setSecret(e.currentTarget.value)}
              rightSectionWidth={64}
              rightSection={
                <Group gap={0} wrap="nowrap">
                  <Tooltip label={t('form.plugins.clients.regenerate')}>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setSecret(generateSecret())}
                      aria-label={t('form.plugins.clients.regenerate')}
                    >
                      <IconRefresh />
                    </ActionIcon>
                  </Tooltip>
                  <CopyValue value={secret} />
                </Group>
              }
            />
            {create.isError && (
              <Alert color="red" variant="light">
                {t('form.plugins.clients.createFailed')}
              </Alert>
            )}
            <Text size="xs" c="dimmed">
              {t('form.plugins.clients.createdAtOnce')}
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setFormOpened(false)}>
                {t('form.btn.cancel')}
              </Button>
              <Button
                onClick={() => create.mutate()}
                loading={create.isPending}
                disabled={!name || !!nameError || !secret}
              >
                {t('form.plugins.clients.create')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
};
