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
  Button,
  Checkbox,
  Code,
  Combobox,
  CopyButton,
  Divider,
  Group,
  InputBase,
  Loader,
  Paper,
  Popover,
  Radio,
  ScrollArea,
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
import { AUTH_CLIENTS_QUERY, AUTH_CLIENTS_STALE_MS, queryClient } from '@/config/query-client';
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
/** Rows drawn at once in the list; typing part of a name reaches the rest. */
const ROWS_SHOWN = 200;

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
 * The clients of the plugin, in one list that can be searched: picked from,
 * when the route lets only some through, and only read, when it lets every
 * holder through - so that who can call it is seen either way, however many
 * there are.
 *
 * Picking lists those holding a credential of the plugin, and any name
 * already on the route's list - another plugin's client, or one this
 * account cannot see - so that saving does not drop it unseen.
 *
 * A box of fixed height that scrolls, rather than a line per client or a
 * pill per name picked: either grew with the gateway until the form was
 * the list.
 */
const ClientList = ({
  clients,
  names: stored,
  readOnly,
  onChange,
}: {
  clients: Clients | undefined;
  /** The names picked; none given, the list is only read. */
  names?: string[];
  readOnly?: boolean;
  onChange?: (names: string[]) => void;
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(false);
  const picking = stored !== undefined;
  // A list written by hand may name a client twice: it is one client.
  const names = [...new Set(stored ?? [])];
  // The clients the route let through when the list was opened come first,
  // so they are in sight however long the list: by the names it opened
  // with, not those ticked since, or a row would jump away when ticked.
  const [pickedFirst] = useState(() => new Set(stored ?? []));
  // An admin of the instance sees every client, as a super admin does: for
  // them a name nobody holds is gone, not out of sight.
  const { isAdmin } = usePermission();
  const holders = clients?.holders ?? [];
  // Looked up for every row at each keystroke: sets, not lists.
  const holding = new Set(holders);
  const known = new Set(clients?.all ?? []);
  const picked = new Set(names);
  const options = (picking ? [...new Set([...holders, ...names])] : [...holders]).sort(
    (a, b) => Number(pickedFirst.has(b)) - Number(pickedFirst.has(a)) || a.localeCompare(b)
  );
  // Why a name is on the list and cannot get through this plugin: it holds
  // no credential of it, or it is no client at all. One this account cannot
  // see may well hold one, and is not to be taken for dead.
  const hint = (option: string): string | undefined => {
    if (!clients || holding.has(option)) return undefined;
    if (known.has(option)) return t('form.plugins.clients.noCredential');
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
        {picking && (
          <Text size="sm" c="red">
            {t('form.plugins.clients.accessEmpty')}
          </Text>
        )}
      </Stack>
    );
  }

  const needle = search.trim().toLowerCase();
  const matching = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;
  const shown = matching.slice(0, ROWS_SHOWN);
  const editable = picking && !readOnly && !!onChange;
  // "All" ticks or unticks every client the search finds - drawn or not, so
  // that ticking it with no search is every client, not the first rows -
  // and Clear unticks them; both leave the rest picked as it was. A search
  // for partner_ then All is every partner, and Clear after it takes back
  // only those, not a name out of sight, which saving would drop unseen.
  const found = new Set(matching);
  const foundPicked = matching.filter((o) => picked.has(o)).length;
  const toggleFound = () =>
    onChange?.(
      foundPicked === matching.length
        ? names.filter((n) => !found.has(n))
        : [...new Set([...names, ...matching])]
    );
  const toggle = (option: string) =>
    onChange?.(picked.has(option) ? names.filter((n) => n !== option) : [...names, option]);

  const title = picking ? t('form.plugins.clients.pick') : t('form.plugins.clients.holders');
  const empty = picking && names.length === 0;

  return (
    <Stack gap="xs">
      {/* A field that says how many, and opens on the list - as the upstream
          picker does - rather than a list taking the form's room for good. */}
      <Popover
        opened={opened}
        onChange={setOpened}
        width="target"
        position="bottom-start"
        shadow="md"
        // Kept open while several are ticked: only a click outside, or
        // Escape, closes it. Focus goes to its search, so that Escape there
        // closes it and hands focus back to the field.
        closeOnClickOutside
        closeOnEscape
        trapFocus
        returnFocus
      >
        <Popover.Target>
          <InputBase
            component="button"
            type="button"
            pointer
            label={title}
            rightSection={<Combobox.Chevron />}
            rightSectionPointerEvents="none"
            onClick={() => setOpened((o) => !o)}
            aria-expanded={opened}
            aria-haspopup="dialog"
            error={empty ? t('form.plugins.clients.accessEmpty') : undefined}
          >
            <span data-testid="client-count">
              {picking
                ? t('form.plugins.clients.countPicked', { picked: names.length, total: options.length })
                : t('form.plugins.clients.countHolders', { total: options.length })}
            </span>
          </InputBase>
        </Popover.Target>
        <Popover.Dropdown p="xs" data-testid="client-dropdown">
          <Stack gap="xs">
            <TextInput
              aria-label={t('form.plugins.clients.search')}
              placeholder={t('form.plugins.clients.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              data-autofocus
            />
            {/* Both act on the rows in sight: none in sight, nothing to act on. */}
            {editable && shown.length > 0 && (
              <>
                <Group px={4} justify="space-between" mih={32}>
                  <Checkbox
                    label={t('form.plugins.clients.allFound', { count: matching.length })}
                    checked={foundPicked === matching.length}
                    indeterminate={foundPicked > 0 && foundPicked < matching.length}
                    onChange={toggleFound}
                  />
                  {foundPicked > 0 && (
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => onChange?.(names.filter((n) => !found.has(n)))}
                    >
                      {t('form.plugins.clients.clearPicked')}
                    </Button>
                  )}
                </Group>
                <Divider />
              </>
            )}
            <ScrollArea.Autosize mah={280} type="auto" offsetScrollbars="y">
              <Stack
                gap={0}
                px={4}
                role={picking ? 'group' : 'list'}
                aria-label={title}
                data-testid="client-list"
              >
                {shown.length === 0 && (
                  <Text size="sm" c="dimmed" py={4}>
                    {clients ? t('form.plugins.clients.noMatch') : t('form.plugins.clients.reading')}
                  </Text>
                )}
                {shown.map((option) =>
                  picking ? (
                    <Checkbox
                      key={option}
                      py={5}
                      label={option}
                      description={hint(option)}
                      checked={picked.has(option)}
                      disabled={!editable}
                      onChange={() => toggle(option)}
                    />
                  ) : (
                    <Text key={option} size="sm" py={4} role="listitem">
                      {option}
                    </Text>
                  )
                )}
              </Stack>
            </ScrollArea.Autosize>
            {matching.length > shown.length && (
              <Text size="xs" c="dimmed">
                {t('form.plugins.clients.listCut', { shown: shown.length, total: matching.length })}
              </Text>
            )}
          </Stack>
        </Popover.Dropdown>
      </Popover>
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
  /**
   * What to say of a restriction this list cannot show, when it is not the
   * route's own plugin that holds it - the route's service's, say.
   */
  customNote?: string;
};

/** The name is a consumer already, one this account cannot see. */
class NameHeldElsewhere extends Error {}
/** The consumer already holds a credential of this plugin. */
class CredentialHeld extends Error {}

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
  customNote,
}: AuthClientsSectionProps) => {
  const { t } = useTranslation();
  const instanceId = useAtomValue(currentInstanceIdAtom);
  // The proxy narrows the consumers to the team picked, so the list is that
  // team's, and keyed by it like every list a team can own.
  const teamId = useAtomValue(listTeamIdAtom);
  const { canCreate, canWriteResource } = usePermission();
  const mayCreate = !readOnly && canCreate && canWriteResource('consumers');

  const clients = useQuery({
    queryKey: [AUTH_CLIENTS_QUERY, instanceId, teamId, plugin],
    queryFn: () => fetchClients(plugin),
    // One request per consumer: not sent again each time a form opens. A
    // write that changes the clients marks it stale (src/config/query-client.ts).
    staleTime: AUTH_CLIENTS_STALE_MS,
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
      // its plugins. The consumer is written create-only, so a name already
      // taken is refused rather than overwritten; then the consumers this
      // account lists are read - as the team picked narrows them, and as the
      // form's own list holds them, but fresh: that list may be older than
      // the gateway. One of them gets the credential alone; any other is held
      // elsewhere. An admin lists every team's, and can give a credential to
      // any of them, as on the consumer's own page.
      let madeConsumer = false;
      try {
        await putConsumerReq(
          req,
          { username: name } as APISIXType['ConsumerPut'],
          { headers: { ...CREATE_ONLY.headers, [SKIP_INTERCEPTOR_HEADER]: ['409'] } }
        );
        madeConsumer = true;
      } catch (e) {
        if (!isAxiosError(e) || e.response?.status !== 409) throw e;
        const usernames = await req
          .get<unknown, APISIXType['RespConsumerList']>(API_CONSUMERS)
          .then((v) => v.data.list.map((item) => item.value.username));
        if (!usernames.includes(name)) throw new NameHeldElsewhere();
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
          { headers: { ...CREATE_ONLY.headers, [SKIP_INTERCEPTOR_HEADER]: ['409'] } }
        );
      } catch (e) {
        // Not left behind empty: a consumer with no credential lets nobody
        // in, and would only be in the way of the next try.
        if (madeConsumer) {
          await req.delete(`${API_CONSUMERS}/${name}`).catch(() => undefined);
        }
        // Given one since the list was read, in another tab or by someone
        // else: the same answer the field gives for a name it knows holds one.
        if (isAxiosError(e) && e.response?.status === 409) throw new CredentialHeld();
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
      void queryClient.invalidateQueries({ queryKey: [AUTH_CLIENTS_QUERY, instanceId] });
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
            {customNote ?? t('form.plugins.clients.accessCustom')}
          </Alert>
        )}

        {access.mode === 'only' && (
          <ClientList
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
            <ClientList clients={clients.data} />
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
                  : create.error instanceof CredentialHeld
                    ? t('form.plugins.clients.nameTaken')
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
