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

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeNodes = (raw: any): Array<{ host: string; port: string | number; weight: number }> => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([key, weight]) => {
    const lastColon = key.lastIndexOf(':');
    const host = lastColon > 0 ? key.substring(0, lastColon) : key;
    const port = lastColon > 0 ? key.substring(lastColon + 1) : '';
    return { host, port, weight: weight as number };
  });
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <Text fw={700} size="lg" style={{ fontFamily: 'Outfit, sans-serif' }}>
    {children}
  </Text>
);

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <Text size="sm" c="dimmed">{children}</Text>
);

export const ServicePreviewSummary = ({ data }: Props) => {
  const { getValues } = useFormContext();
  const { t } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values = (data || getValues()) as Record<string, any>;

  const hosts = values.hosts || [];
  const upstream = values.upstream || {};
  const upstreamId = values.upstream_id;
  const plugins = values.plugins || {};
  const pluginNames = Object.keys(plugins);

  const resolvedUpstreamId = upstreamId && upstreamId !== 'custom' ? upstreamId : undefined;
  const upstreamQuery = useQuery({
    ...getUpstreamQueryOptions(resolvedUpstreamId ?? ''),
    enabled: !!resolvedUpstreamId,
  });
  const fetchedUpstream = upstreamQuery.data?.value;
  const upstreamData = resolvedUpstreamId ? fetchedUpstream : upstream;
  const nodes = normalizeNodes(upstreamData?.nodes);

  return (
    <Stack gap={4}>
      {/* Basic Information */}
      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.basic.title')}</SectionTitle>
        <SimpleGrid cols={3} spacing="md" mt="sm">
          <Stack gap={2}>
            <FieldLabel>{t('form.basic.name')}</FieldLabel>
            <Text size="sm" fw={500}>{values.name || '-'}</Text>
          </Stack>
          {values.desc && (
            <Stack gap={2}>
              <FieldLabel>{t('form.basic.desc')}</FieldLabel>
              <Text size="sm" c="dimmed">{values.desc}</Text>
            </Stack>
          )}
          {hosts.length > 0 && (
            <Stack gap={2}>
              <FieldLabel>{t('form.services.hosts')}</FieldLabel>
              <Group gap={4}>
                {hosts.map((h: string) => (
                  <Badge key={h} variant="light" color="gray" size="sm">{h}</Badge>
                ))}
              </Group>
            </Stack>
          )}
        </SimpleGrid>
      </Paper>

      {/* Upstream */}
      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.services.preview.upstream')}</SectionTitle>
        <Stack gap="sm" mt="sm">
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
          {nodes.length > 0 && !data && !resolvedUpstreamId && (
            <NamePrefixProvider value="upstream">
              <TestConnectionButton />
            </NamePrefixProvider>
          )}
          {upstreamData?.timeout && (
            <SimpleGrid cols={3} spacing="md">
              {upstreamData.timeout.connect != null && (
                <Stack gap={2}>
                  <FieldLabel>{t('form.upstreams.timeout.connect')}</FieldLabel>
                  <Text size="sm" ff="monospace">{`${upstreamData.timeout.connect}s`}</Text>
                </Stack>
              )}
              {upstreamData.timeout.send != null && (
                <Stack gap={2}>
                  <FieldLabel>{t('form.upstreams.timeout.send')}</FieldLabel>
                  <Text size="sm" ff="monospace">{`${upstreamData.timeout.send}s`}</Text>
                </Stack>
              )}
              {upstreamData.timeout.read != null && (
                <Stack gap={2}>
                  <FieldLabel>{t('form.upstreams.timeout.read')}</FieldLabel>
                  <Text size="sm" ff="monospace">{`${upstreamData.timeout.read}s`}</Text>
                </Stack>
              )}
            </SimpleGrid>
          )}
        </Stack>
      </Paper>

      {/* Plugins */}
      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.services.preview.plugins')}</SectionTitle>
        <Stack gap="sm" mt="sm">
          {pluginNames.length > 0 ? (
            <Group gap={6} wrap="wrap">
              {pluginNames.map((name) => (
                <Badge key={name} variant="dot" color="var(--brand)" size="lg">
                  {name}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed" fs="italic">{t('form.services.preview.noPlugins')}</Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
};
