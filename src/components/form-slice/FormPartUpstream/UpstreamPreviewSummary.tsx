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
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { TestConnectionButton } from './TestConnectionButton';

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

export const UpstreamPreviewSummary = ({ data }: Props) => {
  const { getValues } = useFormContext();
  const { t } = useTranslation();
  const values = data || getValues();

  const nodes = normalizeNodes(values.nodes);
  const scheme = values.scheme || 'http';
  const type = values.type || 'roundrobin';
  const passHost = values.pass_host || 'pass';
  const retries = values.retries;
  const timeout = values.timeout || {};
  const keepalivePool = values.keepalive_pool || {};
  const checks = values.checks || {};
  const hasKeepalive = keepalivePool.size || keepalivePool.idle_timeout || keepalivePool.requests;
  const hasChecks = checks.active || checks.passive;

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
          <Stack gap={2}>
            <FieldLabel>{t('form.upstreams.scheme')}</FieldLabel>
            <div><Badge color="blue" variant="light" size="sm">{scheme}</Badge></div>
          </Stack>
          <Stack gap={2}>
            <FieldLabel>{t('form.upstreams.algorithm')}</FieldLabel>
            <div><Badge color="gray" variant="outline" size="sm">{type}</Badge></div>
          </Stack>
        </SimpleGrid>
      </Paper>

      {/* Nodes */}
      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.upstreams.preview.nodesTitle')}</SectionTitle>
        <Stack gap="sm" mt="sm">
          {nodes.length > 0 ? (
            <>
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
              {!data && <TestConnectionButton />}
            </>
          ) : (
            <Text size="sm" c="dimmed" fs="italic">{t('form.upstreams.preview.noNodes')}</Text>
          )}
        </Stack>
      </Paper>

      {/* Connection Settings */}
      <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
        <SectionTitle>{t('form.upstreams.preview.connectionTitle')}</SectionTitle>
        <SimpleGrid cols={3} spacing="md" mt="sm">
          <Stack gap={2}>
            <FieldLabel>{t('form.upstreams.passHost')}</FieldLabel>
            <Text size="sm" ff="monospace">{passHost}</Text>
          </Stack>
          {retries != null && (
            <Stack gap={2}>
              <FieldLabel>{t('form.upstreams.retries')}</FieldLabel>
              <Text size="sm" ff="monospace">{retries}</Text>
            </Stack>
          )}
          {timeout.connect != null && (
            <Stack gap={2}>
              <FieldLabel>{t('form.upstreams.timeout.connect')}</FieldLabel>
              <Text size="sm" ff="monospace">{`${timeout.connect}s`}</Text>
            </Stack>
          )}
          {timeout.send != null && (
            <Stack gap={2}>
              <FieldLabel>{t('form.upstreams.timeout.send')}</FieldLabel>
              <Text size="sm" ff="monospace">{`${timeout.send}s`}</Text>
            </Stack>
          )}
          {timeout.read != null && (
            <Stack gap={2}>
              <FieldLabel>{t('form.upstreams.timeout.read')}</FieldLabel>
              <Text size="sm" ff="monospace">{`${timeout.read}s`}</Text>
            </Stack>
          )}
        </SimpleGrid>
      </Paper>

      {/* Keepalive Pool */}
      {hasKeepalive && (
        <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
          <SectionTitle>{t('form.upstreams.preview.keepaliveTitle')}</SectionTitle>
          <SimpleGrid cols={3} spacing="md" mt="sm">
            {keepalivePool.size && (
              <Stack gap={2}>
                <FieldLabel>{t('form.upstreams.keepalivePool.size')}</FieldLabel>
                <Text size="sm" ff="monospace">{keepalivePool.size}</Text>
              </Stack>
            )}
            {keepalivePool.idle_timeout && (
              <Stack gap={2}>
                <FieldLabel>{t('form.upstreams.keepalivePool.idleTimeout')}</FieldLabel>
                <Text size="sm" ff="monospace">{`${keepalivePool.idle_timeout}s`}</Text>
              </Stack>
            )}
            {keepalivePool.requests && (
              <Stack gap={2}>
                <FieldLabel>{t('form.upstreams.keepalivePool.requests')}</FieldLabel>
                <Text size="sm" ff="monospace">{keepalivePool.requests}</Text>
              </Stack>
            )}
          </SimpleGrid>
        </Paper>
      )}

      {/* Health Checks */}
      {hasChecks && (
        <Paper p="sm" withBorder radius="lg" shadow="xs" style={{ background: 'var(--bg-card)' }}>
          <SectionTitle>{t('form.upstreams.preview.healthChecksTitle')}</SectionTitle>
          <SimpleGrid cols={2} spacing="md" mt="sm">
            {checks.active && (
              <Stack gap={2}>
                <FieldLabel>{t('form.upstreams.preview.activeChecks')}</FieldLabel>
                <Text size="sm">
                  {t('form.upstreams.preview.healthCheckSummary', {
                    path: checks.active.http_path || '/',
                    interval: checks.active.healthy?.interval || '-',
                  })}
                </Text>
              </Stack>
            )}
            {checks.passive && (
              <Stack gap={2}>
                <FieldLabel>{t('form.upstreams.preview.passiveChecks')}</FieldLabel>
                <div><Badge color="green" variant="light" size="sm">{t('table.enabled')}</Badge></div>
              </Stack>
            )}
          </SimpleGrid>
        </Paper>
      )}
    </Stack>
  );
};
