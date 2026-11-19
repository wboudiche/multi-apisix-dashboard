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
  Button,
  Chip,
  Group,
  List,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { postRouteReq } from '@/apis/routes';
import {
  destinationUrlError,
  proposeRouteName,
  type QuickDestination,
  type QuickRoute,
  quickRouteErrors,
  quickRouteToDraft,
  quickRouteToForm,
  ROUTE_ADD_DEFAULTS,
  ROUTE_DRAFT_KEY,
} from '@/components/form-slice/FormPartRoute/quick-create';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { parseToNodes } from '@/components/form-slice/FormPartUpstream/node-rows';
import { ConnectionTest } from '@/components/form-slice/FormPartUpstream/TestConnectionButton';
import { req } from '@/config/req';
import { useAllRoutes, useAllServices, useAllUpstreams } from '@/hooks/useAllUpstreams';
import { currentInstanceIdAtom } from '@/stores/instance';
import type { APISIXType } from '@/types/schema/apisix';
import { errorText } from '@/utils/error-text';
import { upstreamFromServer } from '@/utils/openapi-import';
import { type ComparableRoute, findRouteDuplicates } from '@/utils/route-duplicates';
import { proxyFailureText } from '@/utils/team-refusal';
import IconWarning from '~icons/material-symbols/warning-outline';

// The methods a route is most often limited to; the wizard offers the rest.
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

type DestinationKind = QuickDestination['kind'];


type Props = {
  opened: boolean;
  onClose: () => void;
  /** After a route is created, for the list to read it. */
  onCreated: () => void;
};

/**
 * A route from a path and a destination, on one screen.
 *
 * The common case - expose a path to a backend - took the wizard's five steps
 * and thirty fields, nearly all of them advanced. This asks for what a route
 * cannot do without, posts it the way the wizard does, and hands over to the
 * wizard, answers and all, for anything more.
 */
export const QuickCreateRouteModal = ({ opened, onClose, onCreated }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const instanceId = useAtomValue(currentInstanceIdAtom);

  const [path, setPath] = useState('');
  const [methods, setMethods] = useState<string[]>(ROUTE_ADD_DEFAULTS.methods ?? []);
  const [kind, setKind] = useState<DestinationKind>('url');
  const [url, setUrl] = useState('');
  const [upstreamId, setUpstreamId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [host, setHost] = useState('');
  // Null until typed in: until then the field shows the name it proposes.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: upstreams } = useAllUpstreams(instanceId, opened && kind === 'upstream');
  const { data: services } = useAllServices(instanceId, opened && kind === 'service');
  // Pinned to the instance and keyed by the team, as every whole-instance
  // list is; shared with the label filter's cache.
  const { data: existing } = useAllRoutes(instanceId, opened);

  const name = typedName ?? proposeRouteName(methods, path);

  const destination = useMemo<QuickDestination>(() => {
    if (kind === 'upstream') return { kind, upstreamId: upstreamId ?? '' };
    if (kind === 'service') return { kind, serviceId: serviceId ?? '' };
    return { kind, url };
  }, [kind, url, upstreamId, serviceId]);

  const answers: QuickRoute = { path, methods, host, name, status: 1, destination };

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

  // Shown from the start, greyed out until there is something to dial, so
  // that it is found before it is needed. Not for an upstream picked with no
  // node to dial - found through service discovery, or APISIX's empty {} -
  // where it would stay greyed out for good.
  const awaitingTarget = kind === 'url' || (kind === 'upstream' && !upstreamId);
  const connectionTest = testTarget ? (
    // Keyed by what it dials: an answer about the last address is not one
    // about this one.
    <ConnectionTest key={JSON.stringify(testTarget)} nodes={testTarget.nodes} scheme={testTarget.scheme} />
  ) : (
    awaitingTarget && <ConnectionTest key="none" nodes={[]} scheme={undefined} />
  );

  const errors = quickRouteErrors(answers);
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

  const reset = () => {
    setPath('');
    setMethods(ROUTE_ADD_DEFAULTS.methods ?? []);
    setKind('url');
    setUrl('');
    setUpstreamId(null);
    setServiceId(null);
    setHost('');
    setTypedName(null);
    setShowErrors(false);
    setSubmitError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  // Not while a route is being posted: its answer, success or refusal, has to
  // land in a dialog that is still there to show it.
  const dismiss = () => {
    if (!submitting) close();
  };

  const create = async (status: 0 | 1) => {
    setShowErrors(true);
    setSubmitError(null);
    if (!valid) return;
    setSubmitting(true);
    try {
      await postRouteReq(req, produceRoute(quickRouteToForm({ ...answers, status })));
      notifications.show({
        message: t('info.add.success', { name: t('routes.singular') }),
        color: 'green',
      });
      close();
      onCreated();
    } catch (err) {
      setSubmitError(proxyFailureText(err) || t('routes.createFailed'));
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
    // As a set: a method unticked and ticked again is no edit.
    [...methods].sort().join() === [...(ROUTE_ADD_DEFAULTS.methods ?? [])].sort().join();

  const openWizard = () => {
    if (untouched) {
      close();
      void navigate({ to: '/routes/add' });
      return;
    }
    const go = () => {
      try {
        localStorage.setItem(ROUTE_DRAFT_KEY, JSON.stringify(quickRouteToDraft(answers)));
      } catch {
        // No storage: the wizard opens with its own defaults.
      }
      close();
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

  return (
    <Modal
      opened={opened}
      onClose={dismiss}
      closeOnEscape={!submitting}
      closeOnClickOutside={!submitting}
      title={t('form.quickRoute.title')}
      size="xl"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">{t('form.quickRoute.intro')}</Text>

        <TextInput
          label={t('form.quickRoute.path')}
          description={t('form.quickRoute.pathHint')}
          // eslint-disable-next-line i18next/no-literal-string -- an example path, not prose
          placeholder="/api/orders/*"
          required
          data-autofocus
          value={path}
          onChange={(e) => setPath(e.currentTarget.value)}
          error={shown(errors.path)}
        />

        <Stack gap={4}>
          <Text size="sm" fw={500}>{t('form.quickRoute.methods')}</Text>
          <Chip.Group multiple value={methods} onChange={setMethods}>
            <Group gap={6}>
              {METHODS.map((m) => (
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

        {/* Side by side: the dialog keeps its buttons on a laptop screen. */}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput
            label={t('form.quickRoute.host')}
            description={t('form.quickRoute.hostHint')}
            // eslint-disable-next-line i18next/no-literal-string -- an example host name, not prose
            placeholder="api.example.com"
            value={host}
            onChange={(e) => setHost(e.currentTarget.value)}
          />
          <TextInput
            label={t('form.quickRoute.name')}
            description={t('form.quickRoute.nameHint')}
            required
            value={name}
            onChange={(e) => setTypedName(e.currentTarget.value)}
            error={shown(errors.name)}
          />
        </SimpleGrid>

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
            {submitError}
          </Alert>
        )}

        <Group justify="space-between" mt="sm">
          <Button variant="subtle" onClick={openWizard} disabled={submitting}>
            {t('form.quickRoute.moreOptions')}
          </Button>
          <Group gap="sm">
            <Button variant="default" onClick={dismiss} disabled={submitting}>
              {t('form.btn.cancel')}
            </Button>
            <Button variant="light" onClick={() => create(0)} loading={submitting}>
              {t('form.quickRoute.createOffline')}
            </Button>
            <Button onClick={() => create(1)} loading={submitting}>
              {t('form.quickRoute.create')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};
