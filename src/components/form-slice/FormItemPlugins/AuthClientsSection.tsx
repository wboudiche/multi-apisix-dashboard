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
  MultiSelect,
  Paper,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { putConsumerReq } from '@/apis/consumers';
import { getCredentialListReq, putCredentialReq } from '@/apis/credentials';
import { API_CONSUMERS, SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { queryClient } from '@/config/global';
import { CREATE_ONLY, req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { currentInstanceIdAtom } from '@/stores/instance';
import { listTeamIdAtom } from '@/stores/team';
import type { APISIXType } from '@/types/schema/apisix';
import {
  type AuthClientPlugin,
  canSignJwt,
  CLIENT_NAME_PATTERN,
  clientIdentifier,
  credentialConfig,
  credentialId,
  generateSecret,
  hmacScript,
  holdsCredential,
  jwtKeyClaim,
  type Restriction,
  shellQuote,
  signJwt,
  usableHeader,
} from '@/utils/auth-clients';
import { mapLimit } from '@/utils/map-limit';
import IconAdd from '~icons/material-symbols/add';
import IconCheck from '~icons/material-symbols/check';
import IconCopy from '~icons/material-symbols/content-copy-outline';
import IconRefresh from '~icons/material-symbols/refresh';

type Clients = {
  /** Who holds a credential of the plugin edited. */
  holders: string[];
  /** Every consumer this account sees. */
  all: string[];
};

// Every consumer of the gateway, with what each holds. APISIX lists a
// consumer's credentials separately, so this is one request per consumer:
// a few at a time, so that a gateway with hundreds of them does not get them
// all at once each time the form is opened.
const CREDENTIAL_READS_AT_ONCE = 8;
/** Options drawn at once in the picker; typing reaches the rest. */
const OPTIONS_SHOWN = 50;
/** Holders shown by name before the rest are folded away. */
const HOLDERS_SHOWN = 10;

const fetchClients = async (plugin: AuthClientPlugin): Promise<Clients> => {
  const consumers = await req
    // No page asked for: the gateway then answers with every consumer.
    .get<unknown, APISIXType['RespConsumerList']>(API_CONSUMERS)
    .then((v) => v.data.list.map((item) => item.value));
  const holders = await mapLimit(consumers, CREDENTIAL_READS_AT_ONCE, async (consumer) => {
    if (holdsCredential(plugin, consumer, [])) return consumer.username;
    const creds = await getCredentialListReq(req, { username: consumer.username });
    return holdsCredential(
      plugin,
      consumer,
      creds.list.map((item) => item.value)
    )
      ? consumer.username
      : undefined;
  });
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

type Created = {
  name: string;
  /** What the credential finds the client by, beside its secret. */
  identifier: string;
  secret: string;
  /**
   * For jwt-auth: a token signed with the secret, to try the route with -
   * the claim it was signed in, kept with it, since the form's may change
   * after, and when it expires - or why none could be signed.
   */
  token?: { value: string; exp: number; claim: string } | 'insecure' | 'failed';
};

/** A command or script, with a button that copies it. */
const CopyBlock = ({ value }: { value: string }) => (
  <Group gap={4} wrap="nowrap" align="flex-start">
    <Code block style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {value}
    </Code>
    <CopyValue value={value} />
  </Group>
);

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
  const { t, i18n } = useTranslation();
  if (plugin === 'hmac-auth') {
    return (
      <>
        <Text size="xs" c="dimmed">
          {t('form.plugins.clients.hmacTry')}
        </Text>
        <CopyBlock value={hmacScript(created.identifier, created.secret, config)} />
      </>
    );
  }
  if (plugin === 'jwt-auth') {
    // The header jwt-auth reads, as the form holds it; the gateway takes the
    // token with or without the Bearer word.
    const header = usableHeader(config.header, 'authorization');
    const { token } = created;
    const signed = typeof token === 'object' ? token : undefined;
    return (
      <>
        <Text size="xs" c="dimmed">
          {t('form.plugins.clients.jwtHow', {
            claim: jwtKeyClaim(config),
            identifier: created.identifier,
          })}
        </Text>
        {token === 'insecure' && (
          <Text size="xs" c="dimmed">
            {t('form.plugins.clients.jwtNoSign')}
          </Text>
        )}
        {token === 'failed' && (
          <Text size="xs" c="dimmed">
            {t('form.plugins.clients.jwtSignFailed')}
          </Text>
        )}
        {/* Only while the route reads the claim the token carries. */}
        {signed && signed.claim !== jwtKeyClaim(config) && (
          <Text size="xs" c="dimmed">
            {t('form.plugins.clients.jwtClaimChanged')}
          </Text>
        )}
        {signed && signed.claim === jwtKeyClaim(config) && (
          <>
            <Text size="xs" c="dimmed">
              {t('form.plugins.clients.jwtTry', {
                // In the page's language, with the day: an hour from now
                // may be tomorrow.
                time: new Date(signed.exp * 1000).toLocaleString(i18n.language, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })}
            </Text>
            <CopyBlock
              value={`curl -H ${shellQuote(`${header}: Bearer ${signed.value}`)} http://<gateway>/<path>`}
            />
          </>
        )}
      </>
    );
  }
  // Quoted for the shell it is pasted into: the header is whatever the
  // plugin's form holds, and a quote in it would end the argument early.
  const credential =
    plugin === 'key-auth'
      ? `-H ${shellQuote(`${usableHeader(config.header)}: ${created.secret}`)}`
      : `-u ${shellQuote(`${created.identifier}:${created.secret}`)}`;
  return (
    <>
      <Text size="xs" c="dimmed">
        {t('form.plugins.clients.tryIt')}
      </Text>
      <CopyBlock value={`curl ${credential} http://<gateway>/<path>`} />
    </>
  );
};

/**
 * The clients the route lets through, picked from a list that can be searched:
 * those holding a credential of the plugin, and any name already on the list
 * - another plugin's client, or one this account cannot see - so that saving
 * does not drop it unseen. A list of checkboxes grew with the gateway, one
 * line per client; this one stays the height of the names picked.
 */
const ClientPicker = ({
  clients,
  names,
  readOnly,
  onChange,
}: {
  clients: Clients | undefined;
  names: string[];
  readOnly?: boolean;
  onChange: (names: string[]) => void;
}) => {
  const { t } = useTranslation();
  // An admin of the instance sees every client, as a super admin does: for
  // them a name nobody holds is gone, not out of sight.
  const { isAdmin } = usePermission();
  const holders = clients?.holders ?? [];
  const options = [...new Set([...holders, ...names])].sort();
  // Why a name is on the list and cannot get through this plugin: it holds
  // no credential of it, or it is no client at all. One this account cannot
  // see may well hold one, and is not to be taken for dead.
  const hint = (option: string): string | undefined => {
    if (!clients || holders.includes(option)) return undefined;
    if (clients.all.includes(option)) return t('form.plugins.clients.noCredential');
    return isAdmin
      ? t('form.plugins.clients.notFound')
      : t('form.plugins.clients.notVisible');
  };
  const problems = names.flatMap((name) => {
    const why = hint(name);
    return why ? [{ name, why }] : [];
  });
  if (options.length === 0 && clients) {
    return (
      <Stack gap="xs">
        <Alert color="yellow" variant="light">
          {t('form.plugins.clients.none')}
        </Alert>
        <Text size="sm" c="red">
          {t('form.plugins.clients.accessEmpty')}
        </Text>
      </Stack>
    );
  }
  return (
    <Stack gap="xs">
      <MultiSelect
        label={t('form.plugins.clients.pick')}
        // Mantine keeps showing the placeholder beside the names picked.
        placeholder={names.length ? undefined : t('form.plugins.clients.pickPlaceholder')}
        data={options}
        value={names}
        onChange={onChange}
        // Over the field and never turned below it, where it would lie over
        // the drawer's Add: open, it lets several clients be picked in a row.
        comboboxProps={{ position: 'top', middlewares: { flip: false, shift: true } }}
        // Past what is drawn, said for as long as the list is cut.
        description={
          options.length > OPTIONS_SHOWN
            ? t('form.plugins.clients.pickMore', { total: options.length, shown: OPTIONS_SHOWN })
            : undefined
        }
        searchable
        hidePickedOptions
        nothingFoundMessage={t('form.plugins.clients.noMatch')}
        // Hundreds of options are drawn as hundreds of elements: the first
        // ones are shown, and typing narrows down to the rest.
        limit={OPTIONS_SHOWN}
        maxDropdownHeight={240}
        clearable
        clearButtonProps={{
          'aria-label': t('form.plugins.clients.clearPicked'),
          'aria-hidden': false,
          tabIndex: 0,
        }}
        disabled={readOnly}
        error={names.length === 0 ? t('form.plugins.clients.accessEmpty') : undefined}
        data-testid="client-picker"
      />
      {problems.map(({ name, why }) => (
        <Group key={name} gap={6} wrap="nowrap" align="baseline">
          <Code>{name}</Code>
          <Text size="xs" c="orange.8">
            {why}
          </Text>
        </Group>
      ))}
    </Stack>
  );
};

/** The clients holding a credential: the first few by name, the rest folded. */
const HolderList = ({ holders }: { holders: string[] }) => {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? holders : holders.slice(0, HOLDERS_SHOWN);
  return (
    <Group gap="xs">
      {shown.map((holder) => (
        <Badge key={holder} variant="light" color="gray" size="lg" tt="none">
          {holder}
        </Badge>
      ))}
      {holders.length > HOLDERS_SHOWN && (
        <Button variant="subtle" size="compact-sm" onClick={() => setAll((a) => !a)}>
          {all
            ? t('form.plugins.clients.showFewer')
            : t('form.plugins.clients.showAll', { total: holders.length })}
        </Button>
      )}
    </Group>
  );
};

export type AuthClientsSectionProps = {
  plugin: AuthClientPlugin;
  /** The plugin's configuration as edited, for the header a key goes in. */
  config: Record<string, unknown>;
  /** The plugin is only being looked at: its clients are listed, none made. */
  readOnly?: boolean;
  /** Who the route lets through: every client, or the ones picked. */
  access: Restriction;
  onAccessChange: (next: Restriction) => void;
  /** The names the route held, picked again when "only" is picked back. */
  storedNames: string[];
  /** The route's other authentication plugins, which a client must pass too. */
  otherPlugins: string[];
};

/** The name is a consumer already, one this account cannot see. */
class NameHeldElsewhere extends Error {}

/**
 * Who can get through the plugin, and a way to let one more in, in the
 * plugin's own form: the consumers holding a credential of it, and a new one
 * made from a name with its secret generated.
 */
export const AuthClientsSection = ({
  plugin,
  config,
  readOnly,
  access,
  onAccessChange,
  storedNames,
  otherPlugins,
}: AuthClientsSectionProps) => {
  const { t } = useTranslation();
  const instanceId = useAtomValue(currentInstanceIdAtom);
  // The proxy narrows the consumers to the team picked, so the list is that
  // team's, and keyed by it like every list a team can own.
  const teamId = useAtomValue(listTeamIdAtom);
  const { canCreate, canWriteResource } = usePermission();
  const mayCreate = !readOnly && canCreate && canWriteResource('consumers');

  const clients = useQuery({
    queryKey: ['auth-clients', instanceId, teamId, plugin],
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
      // A consumer that exists keeps what it has: a plain PUT would replace
      // its plugins. One this account sees gets the credential alone; any
      // other is written create-only, so a name already taken - by another
      // team's consumer, which the list does not show - is refused rather
      // than overwritten.
      let madeConsumer = false;
      if (!clients.data?.all.includes(name)) {
        try {
          await putConsumerReq(
            req,
            { username: name } as APISIXType['ConsumerPut'],
            { headers: { ...CREATE_ONLY.headers, [SKIP_INTERCEPTOR_HEADER]: ['409'] } }
          );
          madeConsumer = true;
        } catch (e) {
          if (isAxiosError(e) && e.response?.status === 409) throw new NameHeldElsewhere();
          throw e;
        }
      }
      const identifier = clientIdentifier(name);
      try {
        await putCredentialReq(
          req,
          {
            username: name,
            id: credentialId(plugin),
            plugins: { [plugin]: credentialConfig(plugin, identifier, secret) },
          } as APISIXType['CredentialPut'] & { username: string },
          CREATE_ONLY
        );
      } catch (e) {
        // Not left behind empty: a consumer with no credential lets nobody
        // in, and would only be in the way of the next try.
        if (madeConsumer) {
          await req.delete(`${API_CONSUMERS}/${name}`).catch(() => undefined);
        }
        throw e;
      }
      // A token to try the route with, signed now, while the secret is at
      // hand, and valid an hour from now: the text says until when.
      let token: Created['token'];
      if (plugin === 'jwt-auth' && !canSignJwt()) {
        token = 'insecure';
      } else if (plugin === 'jwt-auth') {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const claim = jwtKeyClaim(config);
        token = await signJwt(claim, identifier, secret, exp)
          .then((value) => ({ value, exp, claim }))
          .catch(() => 'failed' as const);
      }
      return { identifier, token };
    },
    onSuccess: ({ identifier, token }) => {
      setCreated({ name, identifier, secret, token });
      // Made from this form to call this route: on its list at once.
      if (access.mode === 'only' && !access.names.includes(name)) {
        onAccessChange({ mode: 'only', names: [...access.names, name] });
      }
      setFormOpened(false);
      setName('');
      setSecret(generateSecret());
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'consumers',
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth-clients', instanceId] });
    },
  });

  const secretLabel =
    plugin === 'key-auth'
      ? t('form.plugins.clients.key')
      : plugin === 'basic-auth'
        ? t('form.plugins.clients.password')
        : t('form.plugins.clients.secret');
  const description =
    plugin === 'key-auth'
      ? t('form.plugins.clients.descKey')
      : plugin === 'basic-auth'
        ? t('form.plugins.clients.descBasic')
        : plugin === 'jwt-auth'
          ? t('form.plugins.clients.descJwt')
          : t('form.plugins.clients.descHmac');

  return (
    <Paper withBorder radius="md" p="md" mt="md" data-testid="auth-clients">
      <Stack gap="sm">
        <div>
          <Title order={5}>{t('form.plugins.clients.title')}</Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </div>

        {clients.isPending && <Loader size="sm" />}
        {clients.isError && (
          <Alert color="red" variant="light">
            {t('form.plugins.clients.loadFailed')}
          </Alert>
        )}
        {access.mode !== 'custom' && (
          <Radio.Group
            value={access.mode}
            onChange={(mode) =>
              onAccessChange(
                mode === 'only'
                  ? { mode: 'only', names: storedNames }
                  : { mode: 'any' }
              )
            }
          >
            <Stack gap="xs">
              <Radio
                value="any"
                disabled={readOnly}
                label={t('form.plugins.clients.accessAny')}
                description={t('form.plugins.clients.accessAnyHelp')}
              />
              <Radio
                value="only"
                disabled={readOnly}
                label={t('form.plugins.clients.accessOnly')}
                description={t('form.plugins.clients.accessOnlyHelp')}
              />
            </Stack>
          </Radio.Group>
        )}
        {access.mode === 'custom' && (
          <Alert color="blue" variant="light">
            {t('form.plugins.clients.accessCustom')}
          </Alert>
        )}

        {access.mode === 'only' && (
          <ClientPicker
            // While the clients are read, or when they could not be, the
            // names already on the list are still shown, and can be picked.
            clients={clients.data}
            names={access.names}
            readOnly={readOnly}
            onChange={(names) => onAccessChange({ mode: 'only', names })}
          />
        )}
        {otherPlugins.length > 0 && (
          <Text size="xs" c="dimmed">
            {t('form.plugins.clients.alsoAsks', { plugins: otherPlugins.join(', ') })}
          </Text>
        )}
        {clients.data &&
          access.mode !== 'only' &&
          (clients.data.holders.length === 0 ? (
            <Alert color="yellow" variant="light">
              {t('form.plugins.clients.none')}
            </Alert>
          ) : (
            <HolderList holders={clients.data.holders} />
          ))}

        {created && (
          <Alert color="teal" variant="light" withCloseButton onClose={() => setCreated(undefined)}>
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {plugin === 'key-auth'
                  ? t('form.plugins.clients.createdKey', { name: created.name })
                  : plugin === 'basic-auth'
                    ? t('form.plugins.clients.createdPassword', { name: created.name })
                    : t('form.plugins.clients.createdSecret', { name: created.name })}
              </Text>
              <Group gap={4} wrap="nowrap">
                <Code style={{ flex: 1 }}>{created.secret}</Code>
                <CopyValue value={created.secret} />
              </Group>
              {plugin !== 'key-auth' && (
                <>
                  <Text size="xs" c="dimmed">
                    {plugin === 'basic-auth'
                      ? t('form.plugins.clients.identifierBasic')
                      : plugin === 'jwt-auth'
                        ? t('form.plugins.clients.identifierJwt')
                        : t('form.plugins.clients.identifierHmac')}
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    <Code style={{ flex: 1 }}>{created.identifier}</Code>
                    <CopyValue value={created.identifier} />
                  </Group>
                </>
              )}
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
                {create.error instanceof NameHeldElsewhere
                  ? t('form.plugins.clients.nameHeldElsewhere')
                  : t('form.plugins.clients.createFailed')}
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
                // Only against a list that was read: without it, whether the
                // name is a consumer already is not known.
                disabled={!clients.isSuccess || !name || !!nameError || !secret}
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
