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
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { TEST_UPSTREAM_MAX_NODES } from '@/config/constant';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { describeError } from '@/utils/api-error';
import { useNamePrefix } from '@/utils/useNamePrefix';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconNetwork from '~icons/material-symbols/dns';
import IconError from '~icons/material-symbols/error-outline';
import IconWarning from '~icons/material-symbols/warning-outline';

type NodeResult = {
  host: string;
  port: number;
  // not_allowed: not tried, and may well be up (#304). The address is
  // internal, or the name does not resolve: the two read the same on purpose,
  // so that the answer cannot list the internal names that exist.
  status: 'connected' | 'failed' | 'not_allowed';
  message: string;
  rtt_ms?: number;
};

type TestResponse = {
  status: string;
  results: NodeResult[];
};

export const TestConnectionButton = () => {
  const { t } = useTranslation();
  const { control } = useFormContext();
  const np = useNamePrefix();
  const nodes = useWatch({ control, name: np('nodes') });
  const scheme = useWatch({ control, name: np('scheme') });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<NodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canTest = usePermission().canWriteResource('upstreams');

  const hasNodes = nodes && Array.isArray(nodes) && nodes.length > 0 &&
    nodes.some((n: Record<string, unknown>) => n?.host);

  const handleTest = async () => {
    if (!hasNodes) return;
    setLoading(true);
    setResults(null);
    setError(null);

    // In batches, one after the other. If one fails, the batches already
    // answered are still shown, beside the error.
    const tested: NodeResult[] = [];
    try {
      const testNodes = nodes
        .filter((n: Record<string, unknown>) => n?.host)
        .map((n: Record<string, unknown>) => ({
          host: n.host,
          port: Number(n.port) || (scheme === 'https' || scheme === 'grpcs' ? 443 : 80),
        }));

      for (let i = 0; i < testNodes.length; i += TEST_UPSTREAM_MAX_NODES) {
        const res = await req.post<TestResponse>('/test-upstream', {
          nodes: testNodes.slice(i, i + TEST_UPSTREAM_MAX_NODES),
          scheme: scheme || 'http',
        }, { baseURL: '/api/v1' });
        tested.push(...res.data.results);
      }
    } catch (err: unknown) {
      // The backend's own reason (a 403, a 413), not axios's "Request failed
      // with status code N".
      setError(describeError(err, t('form.upstreams.testConnection.failure')));
    } finally {
      setResults(tested.length > 0 ? tested : null);
      setLoading(false);
    }
  };

  // How each status reads. One this build does not know reads as a failure.
  const describe = (r: NodeResult) => {
    switch (r.status) {
      case 'connected':
        return {
          color: 'green',
          Icon: IconCheck,
          // The backend leaves rtt_ms out when it is 0.
          label: `${t('form.upstreams.testConnection.success')} (${r.rtt_ms ?? 0}ms)`,
        };
      case 'not_allowed':
        return {
          color: 'yellow',
          Icon: IconWarning,
          label: t('form.upstreams.testConnection.notTested'),
        };
      default:
        return {
          color: 'red',
          Icon: IconError,
          label: t('form.upstreams.testConnection.failure'),
        };
    }
  };

  // The backend answers only those who can write upstreams on the instance,
  // and a viewer would get a 403 for a click.
  if (!canTest) return null;

  return (
    <Stack gap="xs" mt="xs">
      <Group>
        <Button
          variant="light"
          size="compact-sm"
          leftSection={loading ? <Loader size={14} /> : <IconNetwork width="16" height="16" />}
          onClick={handleTest}
          disabled={!hasNodes || loading}
        >
          {loading
            ? t('form.upstreams.testConnection.testing')
            : t('form.upstreams.testConnection.title')}
        </Button>
      </Group>

      {error && (
        <Alert variant="light" color="red" icon={<IconError width="16" height="16" />}>
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      {results && (
        <Stack gap={4}>
          {results.map((r, i) => {
            const { color, Icon, label } = describe(r);
            return (
              <Alert
                key={i}
                variant="light"
                color={color}
                icon={<Icon width="16" height="16" />}
                p="xs"
              >
                <Group gap="xs">
                  <Text size="sm" fw={500}>{r.host}:{r.port}</Text>
                  <Text size="xs" c="dimmed">{label}</Text>
                </Group>
              </Alert>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
};
