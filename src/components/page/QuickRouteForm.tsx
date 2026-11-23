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
  Alert,
  Anchor,
  Box,
  Button,
  Chip,
  Group,
  List,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { oidcClientApi } from '@/apis/idps';
import { postRouteReq } from '@/apis/routes';
import { AuthClientsSection } from '@/components/form-slice/FormItemPlugins/AuthClientsSection';
import { getPluginCategory } from '@/components/form-slice/FormItemPlugins/pluginMetadata';
import { duplicateRouteBody, duplicateRouteErrors, keptPathRewrite, quickRouteFromRoute } from '@/components/form-slice/FormPartRoute/duplicate-route';
import { FormSectionRequestOverride } from '@/components/form-slice/FormPartRoute/FormSectionRequestOverride';
import {
  destinationUrlError,
  type KeycloakChoice,
  proposeRouteName,
  QUICK_AUTH_PLUGINS,
  type QuickAccess,
  type QuickAuthPlugin,
  type QuickDestination,
  type QuickRoute,
  quickRouteErrors,
  quickRouteToDraft,
  quickRouteToForm,
  RATE_WINDOWS,
  type RateWindow,
  ROUTE_ADD_DEFAULTS,
  ROUTE_DRAFT_KEY,
} from '@/components/form-slice/FormPartRoute/quick-create';
import {
  effectiveKeycloakChoice,
  failureMessageKey,
  failureReason,
  initialKeycloakChoice,
  keycloakChoiceAfterInstanceChange,
  keycloakChoiceAvailable,
  tokenClients,
} from '@/components/form-slice/FormPartRoute/quick-keycloak';
import { QuickKeycloakSection } from '@/components/form-slice/FormPartRoute/QuickKeycloakSection';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { parseToNodes } from '@/components/form-slice/FormPartUpstream/node-rows';
import { ConnectionTest } from '@/components/form-slice/FormPartUpstream/TestConnectionButton';
import { API_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import { useAllRoutes, useAllServices, useAllUpstreams } from '@/hooks/useAllUpstreams';
import { usePermission } from '@/hooks/usePermission';
import { currentInstanceIdAtom } from '@/stores/instance';
import type { APISIXType } from '@/types/schema/apisix';
import { readRestriction, type Restriction, RESTRICTION_PLUGIN } from '@/utils/auth-clients';
import { errorText } from '@/utils/error-text';
import { proposeClientIdSuffix } from '@/utils/keycloak-client';
import { upstreamFromServer } from '@/utils/openapi-import';
import { type ComparableRoute, findRouteDuplicates } from '@/utils/route-duplicates';
import { proxyFailureText } from '@/utils/team-refusal';
import IconTune from '~icons/material-symbols/tune';
import IconWarning from '~icons/material-symbols/warning-outline';

import { ClientSecretDialog, type ShownClient } from './ClientSecretDialog';
import { type KeycloakSaveDeps, KeycloakSaveError, saveWithKeycloak } from './quick-route-keycloak';

// The methods a route is most often limited to; the wizard offers the rest.
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

type DestinationKind = QuickDestination['kind'];

type AccessChoice = 'anyone' | QuickAuthPlugin | 'openid-connect';

const isQuickAuthPlugin = (choice: AccessChoice): choice is QuickAuthPlugin =>
  (QUICK_AUTH_PLUGINS as readonly string[]).includes(choice);

/** What went wrong on a save: the sentence, the answer's reason, and a route left behind. */
type SubmitError = { text: string; reason?: string; routeId?: string };

/** A new authentication plugin's settings: its defaults, none of its own. */
const NO_SETTINGS: Record<string, unknown> = {};
/** A consumer-restriction in force: none, or one not switched off. */
const activeRestriction = (config: unknown): unknown => {
  if (!config || typeof config !== 'object') return undefined;
  const meta = (config as { _meta?: { disable?: unknown } })._meta;
  return meta && typeof meta === 'object' && meta.disable === true ? undefined : config;
};

const ANY_CLIENT: Record<QuickAuthPlugin, Restriction> = {
  'key-auth': { mode: 'any' },
  'basic-auth': { mode: 'any' },
};
const NO_STORED_NAMES: string[] = [];

type Props = {
  /** After a route is made. */
  onCreated: () => void;
  /** Left without one. */
  onCancel: () => void;
  /**
   * The route to copy: the form then duplicates it, with every setting it
   * has and only what is changed here different. Remount it for another
   * route (a key), since it starts from this one.
   */
  source?: APISIXType['Route'];
};

/**
 * A route from a path and a destination, on one page.
 *
 * The common case - expose a path to a backend - took the wizard's five steps
 * and thirty fields, nearly all of them advanced. This asks for what a route
 * cannot do without, posts it the way the wizard does, and hands over to the
 * wizard, answers and all, for anything more.
 *
 * A page rather than a dialog: with the clients and the limit it outgrew a
 * laptop screen, and a click beside a dialog threw away all it held.
 */
export const QuickRouteForm = ({ onCreated, onCancel, source }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const instanceId = useAtomValue(currentInstanceIdAtom);

  // A copy starts from the route; a new route from nothing.
  const sourceName = source ? source.name || source.id : '';
  const [initial] = useState(() =>
    source ? quickRouteFromRoute(source, t('form.quickRoute.nameCopy', { name: sourceName })) : null
  );

  const [path, setPath] = useState(initial?.path ?? '');
  const [methods, setMethods] = useState<string[]>(initial?.methods ?? ROUTE_ADD_DEFAULTS.methods ?? []);
  const [kind, setKind] = useState<DestinationKind>(initial ? 'same' : 'url');
  const [url, setUrl] = useState('');
  const [upstreamId, setUpstreamId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [host, setHost] = useState(initial?.host ?? '');
  // Null until typed in: until then the field shows the name it proposes. A
  // copy has its name from the start.
  const [typedName, setTypedName] = useState<string | null>(initial?.name ?? null);
  // Anyone, as a route is with no authentication plugin. The clients picked
  // go with the authentication: switching it starts over from every client.
  const [accessChoice, setAccessChoice] = useState<AccessChoice>('anyone');
  // Each authentication keeps its own clients picked, and its section stays
  // mounted once shown: a client just made there keeps its secret on screen
  // when the choice is changed and changed back.
  const [restrictions, setRestrictions] = useState<Record<QuickAuthPlugin, Restriction>>(ANY_CLIENT);
  const [shownSections, setShownSections] = useState<QuickAuthPlugin[]>([]);
  // Off until asked for; then a hundred a minute, a limit most APIs can live
  // with, to be changed rather than worked out.
  const [limitOn, setLimitOn] = useState(false);
  const [limitCount, setLimitCount] = useState<number | string>(100);
  const [limitPer, setLimitPer] = useState<RateWindow>('minute');
  // Off until asked for, as the call limit is: the request goes to the
  // backend as it came. Switched off again, what was set is kept, not sent.
  const [overrideOn, setOverrideOn] = useState(false);
  // The advanced form's Request Override section, on a form of its own: it
  // reads and writes plugins['proxy-rewrite'], and the route takes that.
  const rewriteForm = useForm<{ plugins: Record<string, unknown> }>({ defaultValues: { plugins: {} } });
  const rewrite = (useWatch({ control: rewriteForm.control, name: 'plugins' })?.['proxy-rewrite'] ??
    NO_SETTINGS) as Record<string, unknown>;
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The Keycloak token's choice: none until it is picked. Its client id
  // follows the route's name until one is typed, as the name follows the path.
  const [keycloak, setKeycloak] = useState<KeycloakChoice | null>(null);
  const [suffixTyped, setSuffixTyped] = useState(false);
  // The client just made, while its one-time secret is on screen: never in
  // the answers, a draft or a query cache.
  const [shownClient, setShownClient] = useState<ShownClient | null>(null);
  const queryClient = useQueryClient();
  const { isAdmin } = usePermission();

  const { data: upstreams } = useAllUpstreams(instanceId, kind === 'upstream');
  const { data: services } = useAllServices(instanceId, kind === 'service');
  // Pinned to the instance and keyed by the team, as every whole-instance
  // list is; shared with the label filter's cache.
  const { data: existing } = useAllRoutes(instanceId, true);
  // The same queries as the advanced form's client picker, so the two share
  // their cache.
  const linked = useQuery({
    queryKey: ['idps', 'linked', instanceId],
    queryFn: () => oidcClientApi.linked(instanceId),
    enabled: !!instanceId && !source,
  });
  const oidcClients = useQuery({
    queryKey: ['oidc-clients', instanceId],
    queryFn: () => oidcClientApi.list(instanceId),
    enabled: !!instanceId && !source,
    retry: false,
  });
  const creators = useMemo(
    () => (linked.data ?? []).filter((p) => isAdmin || p.developers_can_create),
    [linked.data, isAdmin]
  );
  const reusable = useMemo(() => tokenClients(oidcClients.data ?? []), [oidcClients.data]);

  const name = typedName ?? proposeRouteName(methods, path);

  const destination = useMemo<QuickDestination>(() => {
    if (kind === 'upstream') return { kind, upstreamId: upstreamId ?? '' };
    if (kind === 'service') return { kind, serviceId: serviceId ?? '' };
    if (kind === 'same') return { kind };
    return { kind, url };
  }, [kind, url, upstreamId, serviceId]);

  const duplicating = source !== undefined;
  // A copy keeps the original's plugins, its authentication among them.
  // A service's own plugins: an authentication it sets is kept as it set it,
  // and any other it asks for is one more a client must pass.
  const servicePlugins = useMemo(
    () =>
      (kind === 'service' && services?.list.find((s) => s.value.id === serviceId)?.value.plugins) ||
      NO_SETTINGS,
    [kind, services, serviceId]
  );
  const serviceConfig = (plugin: QuickAuthPlugin) => {
    const config = servicePlugins[plugin];
    return config && typeof config === 'object' ? (config as Record<string, unknown>) : NO_SETTINGS;
  };
  const serviceHasAuth = Object.keys(servicePlugins).some(
    (n) => getPluginCategory(n) === 'authentication'
  );
  const otherAuthPlugins = (plugin: QuickAuthPlugin) =>
    Object.keys(servicePlugins).filter(
      (n) => n !== plugin && getPluginCategory(n) === 'authentication'
    );
  // The service's consumer-restriction, when it holds one in force: who it
  // lets through is where the choice of clients starts. One switched off
  // restricts nobody, and is none to start from.
  const inheritedRestriction = activeRestriction(servicePlugins[RESTRICTION_PLUGIN]);
  const inherited = inheritedRestriction === undefined ? undefined : readRestriction(inheritedRestriction);
  // Seeded once a service is picked and read, and again only when another
  // is: not when the destination is switched away and back, nor while the
  // services are being read, which would throw away the clients picked.
  const serviceRead = kind === 'service' && !!serviceId && !!services;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  // Another instance picked in the header: what was typed stays, and what
  // was picked from the last one's lists - an upstream, a service - goes.
  const [formInstance, setFormInstance] = useState(instanceId);
  if (formInstance !== instanceId) {
    setFormInstance(instanceId);
    setUpstreamId(null);
    setServiceId(null);
    setSeededFor(null);
    // Its connections and clients are another instance's: the choice starts over.
    setKeycloak(keycloakChoiceAfterInstanceChange());
    setSuffixTyped(false);
    if (accessChoice === 'openid-connect') setAccessChoice('anyone');
  }
  const keycloakOffered = keycloakChoiceAvailable({ duplicating, serviceHasAuth, creators, reusable });
  // A service that sets an authentication of its own, or a Keycloak gone from
  // the instance: no token to ask for.
  if (accessChoice === 'openid-connect' && !keycloakOffered) setAccessChoice('anyone');
  const proposedSuffix = proposeClientIdSuffix({ name: name.trim() || path.trim(), hosts: [], uris: [] });
  const keycloakShown = effectiveKeycloakChoice(
    keycloak?.kind === 'create' && !suffixTyped ? { ...keycloak, suffix: proposedSuffix } : keycloak,
    reusable
  );
  if (serviceRead && seededFor !== serviceId) {
    setSeededFor(serviceId);
    const start = inherited ?? { mode: 'any' as const };
    setRestrictions({ 'key-auth': start, 'basic-auth': start });
  }
  const inheritedNames = inherited?.mode === 'only' ? inherited.names : NO_STORED_NAMES;
  const access: QuickAccess | undefined = duplicating
    ? undefined
    : accessChoice === 'openid-connect'
      ? { plugin: 'openid-connect', keycloak: keycloakShown }
      : isQuickAuthPlugin(accessChoice)
        ? {
            plugin: accessChoice,
            restriction: restrictions[accessChoice],
            config: serviceConfig(accessChoice),
            inheritedRestriction,
          }
        : { plugin: null };
  // The service's own limit, which a route's replaces rather than adds to.
  const serviceLimit = servicePlugins['limit-count'] as
    | { count?: unknown; time_window?: unknown }
    | undefined;
  // A client the service asks for is known on the route too: counted as such.
  // A Keycloak token makes no consumer, so its calls are counted by address.
  const byClient = (!!access?.plugin && isQuickAuthPlugin(access.plugin)) || serviceHasAuth;
  // A copy keeps the original's plugins, a limit among them.
  const rateLimit =
    !duplicating && limitOn
      ? { count: Number(limitCount), per: limitPer, byClient }
      : undefined;

  // Turned on beside a service that limits its calls: from the service's
  // limit, when it is one the form can show, rather than a looser hundred.
  const turnLimitOn = (on: boolean) => {
    setLimitOn(on);
    if (!on || !serviceLimit) return;
    const per = (Object.keys(RATE_WINDOWS) as RateWindow[]).find(
      (w) => RATE_WINDOWS[w] === serviceLimit.time_window
    );
    if (typeof serviceLimit.count === 'number' && per) {
      setLimitCount(serviceLimit.count);
      setLimitPer(per);
    }
  };
  // A copy keeps the original's plugins, its proxy-rewrite among them.
  const override = duplicating || !overrideOn
    ? undefined
    : {
        rewrite,
        // A service's own rewrite, which the route's would replace whole.
        inherited: servicePlugins['proxy-rewrite'] as Record<string, unknown> | undefined,
      };
  const answers: QuickRoute = { path, methods, host, name, status: 1, destination, access, rateLimit, override };

  // What the connection test dials: the node an address makes, or the nodes
  // of the upstream picked. Nothing until there is one to dial.
  const testTarget = useMemo(() => {
    const target = (() => {
      if (kind === 'url') {
        const built = destinationUrlError(url) ? null : upstreamFromServer(url.trim());
        return built && {
          nodes: parseToNodes(built.upstream.nodes as APISIXType['UpstreamNodeListOrObj']),
          scheme: built.upstream.scheme as string,
        };
      }
      if (kind === 'upstream' && upstreamId) {
        const picked = upstreams?.list.find((u) => u.value.id === upstreamId)?.value;
        return picked && { nodes: parseToNodes(picked.nodes), scheme: picked.scheme };
      }
      return null;
    })();
    // No node to dial - an upstream found through service discovery, or
    // APISIX's empty {} - offers no test rather than one that never enables.
    return target && target.nodes.length > 0 ? target : null;
  }, [kind, url, upstreamId, upstreams]);

  // Shown once an address is being typed, greyed out until it is one that
  // can be dialed; for an upstream, once one is picked. Not for an upstream
  // with no node to dial - found through service discovery, or APISIX's
  // empty {} - where it would stay greyed out for good.
  const awaitingTarget = kind === 'url' && url.trim() !== '';
  const connectionTest = testTarget ? (
    // Keyed by what it dials: an answer about the last address is not one
    // about this one.
    <ConnectionTest key={JSON.stringify(testTarget)} nodes={testTarget.nodes} scheme={testTarget.scheme} />
  ) : (
    awaitingTarget && <ConnectionTest key="none" nodes={[]} scheme={undefined} />
  );

  const errors = source ? duplicateRouteErrors(source, answers) : quickRouteErrors(answers);
  const valid = Object.keys(errors).length === 0;
  const shown = (key: string | undefined) => (showErrors ? errorText(key) : undefined);

  // The same check as the wizard's: advisory, since APISIX allows two routes
  // on one path and settles between them by priority.
  const duplicates = useMemo(() => {
    if (!existing || !path.trim()) return [];
    return findRouteDuplicates(
      existing.list.map((r) => r.value as ComparableRoute),
      { name, uri: path.trim(), methods }
    );
  }, [existing, name, path, methods]);

  // Set on the way out through one of the form's own buttons, which is
  // where it means to go.
  const leavingRef = useRef(false);

  // Not while a route is being posted: its answer, success or refusal, has to
  // land on a page that is still there to show it.
  const leave = () => {
    if (submitting) return;
    leavingRef.current = true;
    onCancel();
  };

  // The route and its Keycloak client, chained, or neither. Called here
  // rather than through a mutation, whose cache would keep the secret.
  const createWithKeycloak = async (status: 0 | 1, choice: KeycloakChoice) => {
    const form = produceRoute(quickRouteToForm({ ...answers, status }));
    const deps: KeycloakSaveDeps = {
      postRoute: async (body) => (await postRouteReq(req, body)).data.value.id,
      patchRoute: async (id, body) => {
        await req.patch(`${API_ROUTES}/${id}`, body);
      },
      deleteRoute: async (id) => {
        await req.delete(`${API_ROUTES}/${id}`);
      },
      createClient: (idpId, body) => oidcClientApi.create(idpId, body),
      useClient: (uuid) => oidcClientApi.use(instanceId, uuid),
      listClients: () => oidcClientApi.list(instanceId),
      deleteClient: (uuid) => oidcClientApi.remove(instanceId, uuid),
      isAdmin,
    };
    try {
      const { credentials, created } = await saveWithKeycloak(deps, form, status, choice);
      notifications.show({
        message: t('info.add.success', { name: t('routes.singular') }),
        color: 'green',
      });
      if (created) {
        // Only what the dialog shows; the page goes on once it is closed.
        setShownClient({
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          discovery: credentials.discovery,
        });
      } else {
        leavingRef.current = true;
        onCreated();
      }
    } catch (err) {
      if (err instanceof KeycloakSaveError) {
        const f = err.failure;
        setSubmitError({
          // eslint-disable-next-line local/readable-key -- the keys are spelled in failureMessageKey (quick-keycloak.ts)
          text: t(failureMessageKey(f), { name: form.name, clientId: f.clientId }),
          reason: failureReason(f),
          routeId: f.route === 'kept-disabled' ? f.routeId : undefined,
        });
      } else {
        setSubmitError({ text: t('routes.createFailed') });
      }
    } finally {
      // A client made, reused or deleted: the list of clients has changed.
      void queryClient.invalidateQueries({ queryKey: ['oidc-clients', instanceId] });
    }
  };

  const closeShownClient = () => {
    setShownClient(null);
    leavingRef.current = true;
    onCreated();
  };

  const create = async (status: 0 | 1) => {
    setShowErrors(true);
    setSubmitError(null);
    if (!valid) return;
    setSubmitting(true);
    if (!source && access?.plugin === 'openid-connect') {
      // Not free to leave while it is saved: the client's secret is shown
      // only here, once, and leaving asks before it is lost.
      try {
        await createWithKeycloak(status, access.keycloak);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    // Free to leave while it is posted: what was typed is on its way, and
    // its answer is notified wherever the user went.
    leavingRef.current = true;
    try {
      if (source) {
        // The copy belongs to the original's team, not to whichever the
        // header has selected; a route that belongs to none is posted as any.
        const team = (source as { __team_id?: string }).__team_id;
        await req.post(API_ROUTES, duplicateRouteBody(source, { ...answers, status }), {
          ...(team && { headers: { 'X-Team-ID': team } }),
        });
      } else {
        await postRouteReq(req, produceRoute(quickRouteToForm({ ...answers, status })));
      }
      notifications.show({
        message: t('info.add.success', { name: t('routes.singular') }),
        color: 'green',
      });
      onCreated();
    } catch (err) {
      leavingRef.current = false;
      // Shown here too: `req` already notifies a refusal, which is what
      // tells someone who left the page while it was being posted.
      setSubmitError({ text: proxyFailureText(err) || t('routes.createFailed') });
    } finally {
      setSubmitting(false);
    }
  };

  // Nothing typed yet: the wizard has nothing to be handed, and opens as it
  // always has - no draft written, none replaced, no "draft restored".
  const untouched =
    !path.trim() &&
    !url.trim() &&
    !host.trim() &&
    typedName === null &&
    !upstreamId &&
    !serviceId &&
    accessChoice === 'anyone' &&
    !limitOn &&
    !overrideOn &&
    // As a set: a method unticked and ticked again is no edit.
    [...methods].sort().join() === [...(ROUTE_ADD_DEFAULTS.methods ?? [])].sort().join();

  const openWizard = () => {
    if (untouched) {
      leavingRef.current = true;
      void navigate({ to: '/routes/add' });
      return;
    }
    const go = () => {
      try {
        localStorage.setItem(ROUTE_DRAFT_KEY, JSON.stringify(quickRouteToDraft(answers)));
      } catch {
        // No storage: the wizard opens with its own defaults.
      }
      leavingRef.current = true;
      void navigate({ to: '/routes/add' });
    };
    let hasDraft = false;
    try {
      hasDraft = Boolean(localStorage.getItem(ROUTE_DRAFT_KEY));
    } catch {
      hasDraft = false;
    }
    if (!hasDraft) return go();
    modals.openConfirmModal({
      centered: true,
      title: t('form.quickRoute.replaceDraftTitle'),
      children: <Text size="sm">{t('form.quickRoute.replaceDraftBody')}</Text>,
      labels: { confirm: t('form.quickRoute.replaceDraftConfirm'), cancel: t('form.btn.cancel') },
      onConfirm: go,
    });
  };

  // Whatever is typed is asked about before it is thrown away: by a link in
  // the menu, Back, or closing the tab. Not on the way out through Cancel,
  // Create or the advanced form, which are the ways out it offers.
  const [startedAs] = useState(() => JSON.stringify(answers));
  const touched = duplicating ? JSON.stringify(answers) !== startedAs : !untouched;
  const blocker = useBlocker({
    shouldBlockFn: () => touched && !leavingRef.current,
    enableBeforeUnload: () => touched && !leavingRef.current,
    withResolver: true,
  });

  return (
    // A region named as the page is: what the form is for, to a screen reader.
    <Paper
      component="section"
      aria-label={duplicating ? t('form.quickRoute.duplicateTitle', { name: sourceName }) : t('form.quickRoute.title')}
      p="xl"
      radius="md"
      withBorder
    >
      <ClientSecretDialog client={shownClient} onClose={closeShownClient} />
      <Modal
        opened={blocker.status === 'blocked'}
        onClose={() => blocker.reset?.()}
        title={t('form.unsavedChanges.title')}
        centered
        size="sm"
      >
        <Text size="sm" mb="lg">{t('form.unsavedChanges.message')}</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="outline" color="gray" onClick={() => blocker.reset?.()}>
            {t('form.unsavedChanges.stay')}
          </Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>
            {t('form.unsavedChanges.leave')}
          </Button>
        </Group>
      </Modal>
      <Stack gap="md">
        {/* A copy says what it carries; a new route's fields say enough. */}
        {duplicating && (
          <Text size="sm" c="dimmed">
            {t('form.quickRoute.duplicateIntro', { name: sourceName })}
          </Text>
        )}

        <TextInput
          label={t('form.quickRoute.path')}
          description={
            // A copy of a route on several paths says so: a path typed here
            // takes their place.
            source?.uris && source.uris.length > 1
              ? t('form.quickRoute.urisHint', { uris: source.uris.join(', ') })
              : t('form.quickRoute.pathHint')
          }
          // eslint-disable-next-line i18next/no-literal-string -- an example path, not prose
          placeholder="/api/orders/*"
          required
          autoFocus
          value={path}
          onChange={(e) => setPath(e.currentTarget.value)}
          error={shown(errors.path)}
        />

        <Stack gap={4}>
          <Text size="sm" fw={500}>{t('form.quickRoute.methods')}</Text>
          <Chip.Group multiple value={methods} onChange={setMethods}>
            <Group gap={6}>
              {/* With any method a copied route has beyond these, so that
                  each one it keeps can be seen and taken off. */}
              {[...METHODS, ...methods.filter((m) => !METHODS.includes(m))].map((m) => (
                <Chip key={m} value={m} size="xs">
                  {m}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          <Text size="xs" c="dimmed">{t('form.quickRoute.methodsHint')}</Text>
        </Stack>

        <Stack gap={6}>
          <Text size="sm" fw={500}>{t('form.quickRoute.destination')}</Text>
          <SegmentedControl
            value={kind}
            onChange={(v) => setKind(v as DestinationKind)}
            data={[
              // A copy goes where the route goes until told otherwise.
              ...(duplicating ? [{ value: 'same', label: t('form.quickRoute.destSame') }] : []),
              { value: 'url', label: t('form.quickRoute.destUrl') },
              { value: 'upstream', label: t('form.quickRoute.destUpstream') },
              { value: 'service', label: t('form.quickRoute.destService') },
            ]}
          />
          {kind === 'url' && (
            <TextInput
              aria-label={t('form.quickRoute.destUrl')}
              description={t('form.quickRoute.urlHint')}
              // eslint-disable-next-line i18next/no-literal-string -- an example address, not prose
              placeholder="http://10.0.0.5:8080"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              error={shown(errors.destination)}
            />
          )}
          {kind === 'upstream' && (
            <Select
              aria-label={t('form.quickRoute.destUpstream')}
              searchable
              data={(upstreams?.list ?? []).map((u) => ({
                value: u.value.id,
                label: u.value.name || u.value.id,
              }))}
              value={upstreamId}
              onChange={setUpstreamId}
              error={shown(errors.destination)}
            />
          )}
          {connectionTest}
          {kind === 'service' && (
            <Select
              aria-label={t('form.quickRoute.destService')}
              searchable
              data={(services?.list ?? []).map((s) => ({
                value: s.value.id,
                label: s.value.name || s.value.id,
              }))}
              value={serviceId}
              onChange={setServiceId}
              error={shown(errors.destination)}
            />
          )}
        </Stack>

        {/* Side by side: two short fields, one row. */}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput
            label={t('form.quickRoute.host')}
            description={
              // A copy of a route answering for several hosts says so: a
              // host typed here takes their place.
              source?.hosts?.length
                ? t('form.quickRoute.hostsHint', { hosts: source.hosts.join(', ') })
                : t('form.quickRoute.hostHint')
            }
            // eslint-disable-next-line i18next/no-literal-string -- an example host name, not prose
            placeholder="api.example.com"
            value={host}
            onChange={(e) => setHost(e.currentTarget.value)}
          />
          <TextInput
            label={t('form.quickRoute.name')}
            // A hint either way: without one beside Host's, the two fields
            // sat at different heights.
            description={duplicating ? t('form.quickRoute.nameCopyHint') : t('form.quickRoute.nameHint')}
            required
            value={name}
            onChange={(e) => setTypedName(e.currentTarget.value)}
            error={shown(errors.name)}
          />
        </SimpleGrid>

        {!duplicating && (
          <Stack gap={6}>
            {/* Not "Who can call it": the clients section below is titled so. */}
            <Text size="sm" fw={500}>{t('form.quickRoute.access')}</Text>
            <SegmentedControl
              value={accessChoice}
              onChange={(v) => {
                const choice = v as AccessChoice;
                setAccessChoice(choice);
                if (isQuickAuthPlugin(choice) && !shownSections.includes(choice)) {
                  setShownSections([...shownSections, choice]);
                }
                if (choice === 'openid-connect' && !keycloak) {
                  setKeycloak(initialKeycloakChoice(creators, proposedSuffix));
                }
              }}
              data={[
                { value: 'anyone', label: t('form.quickRoute.accessAnyone') },
                { value: 'key-auth', label: t('form.quickRoute.accessKey') },
                { value: 'basic-auth', label: t('form.quickRoute.accessBasic') },
                ...(keycloakOffered
                  ? [{ value: 'openid-connect', label: t('form.quickRoute.accessKeycloak') }]
                  : []),
              ]}
            />
            <Text size="xs" c="dimmed">{t('form.quickRoute.accessHint')}</Text>
            {accessChoice === 'basic-auth' && (
              <Text size="xs" c="orange">{t('form.quickRoute.accessBasicHint')}</Text>
            )}
            {inherited && inherited.mode !== 'custom' && isQuickAuthPlugin(accessChoice) && (
              <Text size="xs" c="orange">{t('form.quickRoute.accessService')}</Text>
            )}
            {shownSections.map((plugin) => (
              <Box key={plugin} display={plugin === accessChoice ? undefined : 'none'}>
                <AuthClientsSection
                  plugin={plugin}
                  config={serviceConfig(plugin)}
                  access={restrictions[plugin]}
                  onAccessChange={(next) => setRestrictions((r) => ({ ...r, [plugin]: next }))}
                  storedNames={inheritedNames}
                  otherPlugins={otherAuthPlugins(plugin)}
                  customNote={t('form.quickRoute.accessServiceCustom')}
                />
              </Box>
            ))}
            {accessChoice === 'openid-connect' && (
              <QuickKeycloakSection
                choice={keycloakShown}
                onChange={(next) => {
                  if (next.kind === 'create' && keycloakShown.kind === 'create' && next.suffix !== keycloakShown.suffix) {
                    setSuffixTyped(true);
                  }
                  setKeycloak(next);
                }}
                creators={creators}
                reusable={reusable}
                proposedSuffix={proposedSuffix}
                error={showErrors ? errors.access : undefined}
                onAdvanced={openWizard}
              />
            )}
          </Stack>
        )}

        {!duplicating && (
          <Stack gap={6}>
            <Switch
              label={t('form.quickRoute.rateLimit')}
              checked={limitOn}
              onChange={(e) => turnLimitOn(e.currentTarget.checked)}
            />
            {serviceLimit && (
              <Text size="xs" c="orange">{t('form.quickRoute.rateLimitService')}</Text>
            )}
            {limitOn && (
              <>
                <Group gap="sm" align="flex-start">
                  {/* Two labelled fields rather than a sentence around them:
                      not every language puts the count before the period. */}
                  <NumberInput
                    label={t('form.quickRoute.rateLimitCount')}
                    min={1}
                    allowDecimal={false}
                    allowNegative={false}
                    w={140}
                    value={limitCount}
                    onChange={setLimitCount}
                    error={shown(errors.rateLimit)}
                  />
                  <Select
                    label={t('form.quickRoute.rateLimitPer')}
                    w={140}
                    allowDeselect={false}
                    value={limitPer}
                    onChange={(v) => v && setLimitPer(v as RateWindow)}
                    data={[
                      { value: 'second', label: t('form.quickRoute.per.second') },
                      { value: 'minute', label: t('form.quickRoute.per.minute') },
                      { value: 'hour', label: t('form.quickRoute.per.hour') },
                      { value: 'day', label: t('form.quickRoute.per.day') },
                    ] satisfies { value: RateWindow; label: string }[]}
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  {byClient
                    ? t('form.quickRoute.rateLimitByClient')
                    : t('form.quickRoute.rateLimitByIp')}
                </Text>
              </>
            )}
          </Stack>
        )}

        {!duplicating && (
          <Switch
            label={t('form.quickRoute.override')}
            checked={overrideOn}
            onChange={(e) => setOverrideOn(e.currentTarget.checked)}
          />
        )}
        {!duplicating && overrideOn && (
          <FormProvider {...rewriteForm}>
            <FormSectionRequestOverride />
            {showErrors && (errors.overrideHost || errors.overrideUri || errors.overrideHeaders) && (
              <Stack gap={2}>
                {[errors.overrideUri, errors.overrideHost, errors.overrideHeaders].filter(Boolean).map((key) => (
                  <Text key={key} size="sm" c="red">{errorText(key)}</Text>
                ))}
              </Stack>
            )}
          </FormProvider>
        )}

        {duplicates.length > 0 && (
          // Why each is one, as the wizard says it: a route on this path and a
          // route of this name are two different clashes.
          <Alert color="yellow" variant="light" icon={<IconWarning />} title={t('form.routes.duplicateConfirmTitle')}>
            <List size="sm" spacing={2}>
              {duplicates.map((d) => (
                <List.Item key={`${d.id}-${d.reasons.join()}`}>
                  {t(
                    d.reasons.includes('name') && d.reasons.includes('path')
                      ? 'form.routes.duplicateReasonBoth'
                      : d.reasons.includes('name')
                        ? 'form.routes.duplicateReasonName'
                        : 'form.routes.duplicateReasonPath',
                    { name: d.name, uri: d.uri }
                  )}
                </List.Item>
              ))}
            </List>
          </Alert>
        )}

        {source && keptPathRewrite(source, answers) && (
          <Alert color="yellow" variant="light" icon={<IconWarning />}>
            {t('form.quickRoute.rewriteKept', { name: sourceName, rewrite: keptPathRewrite(source, answers)! })}
          </Alert>
        )}

        {showErrors && errors.other && (
          <Alert color="red" variant="light">
            <List size="sm" spacing={2}>
              {errors.other.map((message) => (
                <List.Item key={message}>{errorText(message)}</List.Item>
              ))}
            </List>
          </Alert>
        )}

        {submitError && (
          <Alert color="red" variant="light">
            <Stack gap={4}>
              <Text size="sm">{submitError.text}</Text>
              {submitError.reason && <Text size="sm">{submitError.reason}</Text>}
              {submitError.routeId && (
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  w="fit-content"
                  onClick={() => {
                    leavingRef.current = true;
                    void navigate({ to: '/routes/detail/$id', params: { id: submitError.routeId! } });
                  }}
                >
                  {t('form.btn.view')}
                </Anchor>
              )}
            </Stack>
          </Alert>
        )}

        <Group justify="space-between" mt="sm">
          {/* A copy carries what the wizard's draft cannot - every plugin,
              var and setting of the route - so it is made here. */}
          {duplicating ? (
            <span />
          ) : (
            // A button: as grey text it read as a note rather than the way
            // on to the advanced form.
            <Button
              variant="default"
              leftSection={<IconTune width="16" height="16" />}
              onClick={openWizard}
              disabled={submitting}
            >
              {t('form.quickRoute.continueAdvanced')}
            </Button>
          )}
          <Group gap="sm">
            <Button variant="default" onClick={leave} disabled={submitting}>
              {t('form.btn.cancel')}
            </Button>
            {/* A copy answers on the route's own path: offline is its first
                choice, so it takes no traffic before it is meant to. */}
            <Button variant={duplicating ? 'filled' : 'light'} onClick={() => create(0)} loading={submitting}>
              {t('form.quickRoute.createOffline')}
            </Button>
            <Button variant={duplicating ? 'light' : 'filled'} onClick={() => create(1)} loading={submitting}>
              {t('form.quickRoute.create')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
};
