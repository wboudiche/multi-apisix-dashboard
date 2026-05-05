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
  Badge,
  Code,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { getUpstreamQueryOptions } from '@/apis/hooks';
import { TestConnectionButton } from '@/components/form-slice/FormPartUpstream/TestConnectionButton';
import { NamePrefixProvider } from '@/utils/useNamePrefix';

import type { RoutePostType } from './schema';
import { METHOD_COLORS, normalizeNodes, SERVICE_NONE, UPSTREAM_CUSTOM } from './util';

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <Text fw={700} size="lg" style={{ fontFamily: 'Outfit, sans-serif' }}>
    {children}
  </Text>
);

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <Text size="sm" c="dimmed">{children}</Text>
);

const FieldValue = ({ children, mono }: { children: React.ReactNode; mono?: boolean }) => (
  <Text size="sm" fw={500} ff={mono ? 'monospace' : undefined}>{children}</Text>
);

export const RoutePreviewSummary = ({ data }: Props) => {
  const { getValues } = useFormContext<RoutePostType>();
  const { t } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values = (data || getValues()) as Record<string, any>;

  const methods = values.methods || [];
  const uri = values.uri || '';
  const uris = values.uris || [];
  const host = values.host || '';
  const hosts = values.hosts || [];
  const plugins = values.plugins || {};
  const pluginNames = Object.keys(plugins);
  const upstream = values.upstream;
  const upstreamId = values.upstream_id;
  const serviceId = values.service_id;

  const resolvedUpstreamId = upstreamId && upstreamId !== UPSTREAM_CUSTOM ? upstreamId : undefined;
  const upstreamQuery = useQuery({
    ...getUpstreamQueryOptions(resolvedUpstreamId ?? ''),
    enabled: !!resolvedUpstreamId,
  });
  const fetchedUpstream = upstreamQuery.data?.value;
  const isCustom = upstreamId === UPSTREAM_CUSTOM || (!upstreamId && upstream?.nodes);
  const upstreamData = isCustom ? upstream : fetchedUpstream;
  const nodes = normalizeNodes(upstreamData?.nodes);

  return (
    <Stack gap={4}>
      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.routes.preview.matchPreviewLabel')}</SectionTitle>
        <Group gap="xs" mt="sm" wrap="wrap">
          {methods.length > 0 ? (
            methods.map((m: string) => (
              <Badge key={m} color={METHOD_COLORS[m] || 'gray'} variant="filled" size="lg" radius="sm">
                {m}
              </Badge>
            ))
          ) : (
            <Badge color="gray" variant="light" size="lg" radius="sm">{t('form.routes.preview.allMethods')}</Badge>
          )}
          <Code style={{ fontSize: '0.95rem', padding: '4px 14px' }}>
            {uri || uris.join(', ') || '/'}
          </Code>
          {(host || hosts.length > 0) && (
            <>
              <Text size="sm" c="dimmed">@</Text>
              <Text size="sm" fw={500}>{host || hosts.join(', ')}</Text>
            </>
          )}
        </Group>
      </Paper>

      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.routes.preview.apiInfo')}</SectionTitle>
        <SimpleGrid cols={3} spacing="md" mt="sm">
          <Stack gap={2}>
            <FieldLabel>{t('form.basic.name')}</FieldLabel>
            <FieldValue>{values.name || '-'}</FieldValue>
          </Stack>
          <Stack gap={2}>
            <FieldLabel>{t('form.basic.status')}</FieldLabel>
            <div>
              <Badge color={values.status === 1 ? 'green' : 'red'} variant="light" size="sm">
                {values.status === 1 ? t('table.enabled') : t('table.disabled')}
              </Badge>
            </div>
          </Stack>
          <Stack gap={2}>
            <FieldLabel>{t('form.routes.priority')}</FieldLabel>
            <FieldValue mono>{values.priority ?? 0}</FieldValue>
          </Stack>
          {values.desc && (
            <Stack gap={2}>
              <FieldLabel>{t('form.basic.desc')}</FieldLabel>
              <Text size="sm" c="dimmed">{values.desc}</Text>
            </Stack>
          )}
        </SimpleGrid>
      </Paper>

      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.routes.preview.upstream')}</SectionTitle>
        <Stack gap="sm" mt="sm">
          {serviceId && serviceId !== SERVICE_NONE ? (
            <Group gap="xs">
              <Badge color="violet" variant="light">{t('form.routes.preview.boundToService')}</Badge>
              <Code>{serviceId}</Code>
            </Group>
          ) : !upstreamData && !upstreamId ? (
            <Text size="sm" c="dimmed" fs="italic">{t('form.routes.preview.noUpstream')}</Text>
          ) : (
            <>
              <Group gap="xs">
                {fetchedUpstream?.name && (
                  <Text size="sm" fw={600}>{fetchedUpstream.name}</Text>
                )}
                <Badge color="blue" variant="light" size="sm">{upstreamData?.scheme || 'http'}</Badge>
                <Badge color="gray" variant="outline" size="sm">{upstreamData?.type || 'roundrobin'}</Badge>
              </Group>
              {nodes.length > 0 && (
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('form.upstreams.nodes.host.title')}</Table.Th>
                      <Table.Th>{t('form.upstreams.nodes.port.title')}</Table.Th>
                      <Table.Th>{t('form.upstreams.nodes.weight.title')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {nodes.map((node, i) => (
                      <Table.Tr key={i}>
                        <Table.Td><Code style={{ background: 'transparent', padding: 0 }}>{node.host}</Code></Table.Td>
                        <Table.Td><Text size="sm" ff="monospace">{node.port || '-'}</Text></Table.Td>
                        <Table.Td><Text size="sm" ff="monospace">{node.weight ?? 1}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              {nodes.length > 0 && !data && isCustom && (
                <NamePrefixProvider value="upstream">
                  <TestConnectionButton />
                </NamePrefixProvider>
              )}
            </>
          )}
        </Stack>
      </Paper>

      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.routes.preview.plugins')}</SectionTitle>
        <Stack gap="sm" mt="sm">
          {pluginNames.length > 0 ? (
            <Group gap={6} wrap="wrap">
              {pluginNames.map((name) => (
                <Badge key={name} variant="dot" color="var(--brand)" size="lg">
                  {name}
                </Badge>
              ))}
            </Group>
          ) : values.plugin_config_id ? (
            <Group gap="xs">
              <Text size="sm" c="dimmed">{t('form.plugins.configId')}:</Text>
              <Code>{values.plugin_config_id}</Code>
            </Group>
          ) : (
            <Text size="sm" c="dimmed" fs="italic">{t('form.routes.preview.noPlugins')}</Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
};
