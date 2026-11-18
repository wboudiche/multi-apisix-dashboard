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
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteListReq, postRouteReq } from '@/apis/routes';
import {
  destinationUrlError,
  proposeRouteName,
  type QuickDestination,
  type QuickRoute,
  quickRouteToDraft,
  quickRouteToForm,
  ROUTE_ADD_DEFAULTS,
  ROUTE_DRAFT_KEY,
} from '@/components/form-slice/FormPartRoute/quick-create';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import { useAllServices, useAllUpstreams } from '@/hooks/useAllUpstreams';
import { currentInstanceIdAtom } from '@/stores/instance';
import { errorText } from '@/utils/error-text';
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
  const { data: existing } = useQuery({
    queryKey: ['routes', 'quick-create', instanceId],
    queryFn: () => getRouteListReq(req, { page: 1, page_size: PAGE_SIZE_MAX }),
    enabled: opened,
  });

  const name = typedName ?? proposeRouteName(methods, path);

  const destination = useMemo<QuickDestination>(() => {
    if (kind === 'upstream') return { kind, upstreamId: upstreamId ?? '' };
    if (kind === 'service') return { kind, serviceId: serviceId ?? '' };
    return { kind, url };
  }, [kind, url, upstreamId, serviceId]);

  const answers: QuickRoute = { path, methods, host, name, status: 1, destination };

  const errors = {
    path: path.trim() ? undefined : 'form.validation.uriRequired',
    name: name.trim() ? undefined : 'form.validation.nameRequired',
    url: kind === 'url' ? destinationUrlError(url) : undefined,
    upstream: kind === 'upstream' && !upstreamId ? 'form.validation.upstreamRequired' : undefined,
    service: kind === 'service' && !serviceId ? 'form.validation.serviceRequired' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
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
    methods.join() === (ROUTE_ADD_DEFAULTS.methods ?? []).join();

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
    <Modal opened={opened} onClose={close} title={t('form.quickRoute.title')} size="lg" centered>
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
              error={shown(errors.url)}
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
              error={shown(errors.upstream)}
            />
          )}
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
              error={shown(errors.service)}
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
          <Alert color="yellow" variant="light" icon={<IconWarning />}>
            {t('form.quickRoute.duplicate', { names: duplicates.map((d) => d.name).join(', ') })}
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
            <Button variant="default" onClick={close} disabled={submitting}>
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
