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

import { req } from '@/config/req';
import { useNamePrefix } from '@/utils/useNamePrefix';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconNetwork from '~icons/material-symbols/dns';
import IconError from '~icons/material-symbols/error-outline';

type NodeResult = {
  host: string;
  port: number;
  status: string;
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
  const [results, setResults] = useState<TestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasNodes = nodes && Array.isArray(nodes) && nodes.length > 0 &&
    nodes.some((n: Record<string, unknown>) => n?.host);

  const handleTest = async () => {
    if (!hasNodes) return;
    setLoading(true);
    setResults(null);
    setError(null);

    try {
      const testNodes = nodes
        .filter((n: Record<string, unknown>) => n?.host)
        .map((n: Record<string, unknown>) => ({
          host: n.host,
          port: Number(n.port) || (scheme === 'https' || scheme === 'grpcs' ? 443 : 80),
        }));

      const res = await req.post<TestResponse>('/test-upstream', {
        nodes: testNodes,
        scheme: scheme || 'http',
      }, { baseURL: '/api/v1' });
      setResults(res.data);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message || t('form.upstreams.testConnection.failure'));
    } finally {
      setLoading(false);
    }
  };

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
          {results.results.map((r, i) => (
            <Alert
              key={i}
              variant="light"
              color={r.status === 'connected' ? 'green' : 'red'}
              icon={r.status === 'connected'
                ? <IconCheck width="16" height="16" />
                : <IconError width="16" height="16" />
              }
              p="xs"
            >
              <Group gap="xs">
                <Text size="sm" fw={500}>{r.host}:{r.port}</Text>
                <Text size="xs" c="dimmed">
                  {r.status === 'connected'
                    ? `${t('form.upstreams.testConnection.success')} (${r.rtt_ms}ms)`
                    : r.message}
                </Text>
              </Group>
            </Alert>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
