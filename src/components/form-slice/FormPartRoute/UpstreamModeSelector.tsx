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
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  getServiceListQueryOptions,
  getUpstreamListQueryOptions,
} from '@/apis/hooks';
import { FormItemSelect } from '@/components/form/Select';
import { NamePrefixProvider } from '@/utils/useNamePrefix';
import IconCloud from '~icons/material-symbols/cloud-outline';
import IconDns from '~icons/material-symbols/dns-outline';
import IconSettings from '~icons/material-symbols/settings-outline';
import IconWarning from '~icons/material-symbols/warning-outline';

import { FormPartUpstream } from '../FormPartUpstream';
import { FormSection } from '../FormSection';
import type { RoutePostType } from './schema';
import { nodeHostsFrom, SERVICE_NONE, UPSTREAM_CUSTOM } from './util';

type UpstreamMode = 'service' | 'existing' | 'custom';

const ModeCard = ({
  icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) => (
  <UnstyledButton onClick={onClick} style={{ flex: 1 }}>
    <Card
      padding="md"
      radius="md"
      withBorder
      style={{
        borderColor: active ? 'var(--mantine-color-blue-6)' : undefined,
        borderWidth: active ? 2 : 1,
        background: active ? 'var(--mantine-color-blue-0)' : undefined,
        cursor: 'pointer',
        transition: 'all 150ms ease',
      }}
    >
      <Stack gap={6} align="center">
        <div style={{ color: active ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)' }}>
          {icon}
        </div>
        <Text size="sm" fw={active ? 600 : 500} ta="center">
          {title}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {description}
        </Text>
      </Stack>
    </Card>
  </UnstyledButton>
);

const ServiceSummary = ({ serviceId }: { serviceId: string }) => {
  const { t } = useTranslation();
  const { data: services } = useSuspenseQuery(
    getServiceListQueryOptions({ page: 1, page_size: 500 })
  );

  const service = useMemo(
    () => services?.list?.find((s) => s.value.id === serviceId),
    [services, serviceId]
  );

  if (!service) return null;
  const val = service.value;
  const hosts = val.hosts?.length ? val.hosts.join(', ') : null;
  const pluginCount = val.plugins ? Object.keys(val.plugins).length : 0;
  const nodeHosts = nodeHostsFrom(val.upstream?.nodes);

  return (
    <Card padding="sm" radius="md" withBorder bg="var(--mantine-color-blue-0)">
      <Stack gap={6}>
        <Group gap="xs">
          <Text size="sm" fw={600}>{val.name || val.id}</Text>
          {val.desc && <Text size="xs" c="dimmed">{val.desc}</Text>}
        </Group>
        <Group gap="xs">
          {hosts && <Badge variant="light" size="sm">{hosts}</Badge>}
          {nodeHosts.length > 0 && nodeHosts.map((host) => (
            <Badge key={host} variant="light" color="teal" size="sm">
              {host}
            </Badge>
          ))}
          {pluginCount > 0 && (
            <Badge variant="light" color="violet" size="sm">
              {t('form.upstreamMode.pluginsCount', { count: pluginCount })}
            </Badge>
          )}
          {val.upstream?.scheme && (
            <Badge variant="light" color="gray" size="sm">
              {val.upstream.scheme}
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed" fs="italic">
          {t('form.upstreamMode.serviceProvides')}
        </Text>
      </Stack>
    </Card>
  );
};

const UpstreamSummary = ({ upstreamId }: { upstreamId: string }) => {
  const { t } = useTranslation();
  const { data: upstreams } = useSuspenseQuery(
    getUpstreamListQueryOptions({ page: 1, page_size: 500 })
  );

  const upstream = useMemo(
    () => upstreams?.list?.find((u) => u.value.id === upstreamId),
    [upstreams, upstreamId]
  );

  if (!upstream) return null;
  const val = upstream.value;
  const nodeHosts = nodeHostsFrom(val.nodes);

  return (
    <Card padding="sm" radius="md" withBorder bg="var(--mantine-color-teal-0)">
      <Stack gap={6}>
        <Text size="sm" fw={600}>{val.name || val.id}</Text>
        <Group gap="xs">
          {nodeHosts.length > 0 && nodeHosts.map((host) => (
            <Badge key={host} variant="light" color="teal" size="sm">
              {host}
            </Badge>
          ))}
          {val.type && (
            <Badge variant="light" color="gray" size="sm">
              {val.type}
            </Badge>
          )}
          {val.scheme && (
            <Badge variant="light" color="gray" size="sm">
              {t('form.upstreamMode.scheme')}: {val.scheme}
            </Badge>
          )}
        </Group>
      </Stack>
    </Card>
  );
};

export const UpstreamModeSelector = () => {
  const { t } = useTranslation();
  const { control, setValue, formState: { errors } } = useFormContext<RoutePostType>();

  const serviceId = useWatch({ control, name: 'service_id' });
  const upstreamId = useWatch({ control, name: 'upstream_id' });
  const upstreamIdError = errors.upstream_id?.message;

  const [mode, setModeState] = useState<UpstreamMode>(() => {
    if (serviceId && serviceId !== SERVICE_NONE) return 'service';
    if (upstreamId && upstreamId !== UPSTREAM_CUSTOM) return 'existing';
    return 'custom';
  });

  const { data: services } = useSuspenseQuery(
    getServiceListQueryOptions({ page: 1, page_size: 500 })
  );
  const { data: upstreams } = useSuspenseQuery(
    getUpstreamListQueryOptions({ page: 1, page_size: 500 })
  );

  const serviceOptions = useMemo(
    () =>
      services?.list?.map((v) => ({
        value: v.value.id,
        label: v.value.name || v.value.id,
      })) || [],
    [services]
  );

  const upstreamOptions = useMemo(
    () =>
      upstreams?.list?.map((v) => ({
        value: v.value.id,
        label: v.value.name || v.value.id,
      })) || [],
    [upstreams]
  );

  const setMode = useCallback(
    (newMode: UpstreamMode) => {
      setModeState(newMode);
      if (newMode === 'service') {
        setValue('upstream_id', undefined as never);
        setValue('upstream', undefined as never);
      } else if (newMode === 'existing') {
        setValue('service_id', undefined as never);
        setValue('upstream_id', undefined as never);
        setValue('upstream', undefined as never);
      } else {
        setValue('service_id', undefined as never);
        setValue('upstream_id', UPSTREAM_CUSTOM);
      }
    },
    [setValue]
  );

  return (
    <Stack gap="md">
      {upstreamIdError && (
        <Alert variant="light" color="red" icon={<IconWarning width="16" height="16" />}>
          <Text size="sm">{upstreamIdError}</Text>
        </Alert>
      )}
      <FormSection legend={t('form.upstreamMode.title')}>
        <SimpleGrid cols={3} spacing="sm">
          <ModeCard
            icon={<IconSettings width="24" height="24" />}
            title={t('form.upstreamMode.custom')}
            description={t('form.upstreamMode.customDesc')}
            active={mode === 'custom'}
            onClick={() => setMode('custom')}
          />
          <ModeCard
            icon={<IconDns width="24" height="24" />}
            title={t('form.upstreamMode.existing')}
            description={t('form.upstreamMode.existingDesc')}
            active={mode === 'existing'}
            onClick={() => setMode('existing')}
          />
          <ModeCard
            icon={<IconCloud width="24" height="24" />}
            title={t('form.upstreamMode.service')}
            description={t('form.upstreamMode.serviceDesc')}
            active={mode === 'service'}
            onClick={() => setMode('service')}
          />
        </SimpleGrid>
      </FormSection>

      {mode === 'service' && (
        <FormSection legend={t('form.routes.service')}>
          <FormItemSelect
            control={control}
            name="service_id"
            label={t('form.routes.service')}
            data={serviceOptions}
            searchable
            clearable
          />
          {serviceId && serviceId !== SERVICE_NONE && (
            <ServiceSummary serviceId={serviceId} />
          )}
        </FormSection>
      )}

      {mode === 'existing' && (
        <FormSection legend={t('form.upstreams.title')}>
          <FormItemSelect
            control={control}
            name="upstream_id"
            label={t('form.upstreams.title')}
            data={upstreamOptions}
            searchable
            clearable
          />
          {upstreamId && upstreamId !== UPSTREAM_CUSTOM && (
            <UpstreamSummary upstreamId={upstreamId} />
          )}
        </FormSection>
      )}

      {mode === 'custom' && (
        <FormSection legend={t('form.upstreams.title')}>
          <NamePrefixProvider value="upstream">
            <FormPartUpstream simplified />
          </NamePrefixProvider>
        </FormSection>
      )}
    </Stack>
  );
};
