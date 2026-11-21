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
import { useEffect, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { SKIP_INTERCEPTOR_HEADER, TEST_UPSTREAM_MAX_NODES } from '@/config/constant';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import type { APISIXType } from '@/types/schema/apisix';
import { describeError, probeLimitKey } from '@/utils/api-error';
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
  // not_tested: not tried either, and for a reason that is about the
  // dashboard rather than the node - it was at its ceiling on outbound tests
  // and this node's turn never came (#310).
  status: 'connected' | 'failed' | 'not_allowed' | 'not_tested';
  message: string;
  rtt_ms?: number;
};

type TestResponse = {
  status: string;
  results: NodeResult[];
};

type ConnectionTestProps = {
  /** The nodes to dial, in the list shape: a host and, maybe, a port. */
  nodes: APISIXType['UpstreamNodes'] | undefined;
  scheme: string | undefined;
};

/**
 * The port a node given none is dialed on: its scheme's own, for the schemes
 * that have one. A stream upstream's node (tcp, tls, udp) has none to guess,
 * and dialing it on 80 would test something else entirely.
 */
const defaultPort = (scheme: string | undefined) => {
  if (scheme === 'https' || scheme === 'grpcs') return 443;
  if (!scheme || scheme === 'http' || scheme === 'grpc') return 80;
  return undefined;
};

/**
 * Has the dashboard dial each node and says how each answered. Given the
 * nodes rather than reading them from a form, so the upstream form and the
 * quick route page test the same way.
 */
export const ConnectionTest = ({ nodes, scheme }: ConnectionTestProps) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<NodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canTest = usePermission().canWriteResource('upstreams');

  // What can be dialed: a node with a host, and a port of its own or its
  // scheme's.
  const testNodes = (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n?.host)
    .map((n) => ({ host: n.host, port: Number(n.port) || defaultPort(scheme) }))
    .filter((n): n is { host: string; port: number } => n.port !== undefined);
  const hasNodes = testNodes.length > 0;

  // A test still running when this goes - its nodes changed, the quick page
  // left - stops rather than spending the dashboard's outbound budget (#310)
  // on an answer nobody will see.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const handleTest = async () => {
    if (!hasNodes) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setResults(null);
    setError(null);

    // In batches, one after the other. If one fails, the batches already
    // answered are still shown, beside the error.
    const tested: NodeResult[] = [];
    try {
      for (let i = 0; i < testNodes.length; i += TEST_UPSTREAM_MAX_NODES) {
        const res = await req.post<TestResponse>('/test-upstream', {
          nodes: testNodes.slice(i, i + TEST_UPSTREAM_MAX_NODES),
          scheme: scheme || 'http',
        }, {
          baseURL: '/api/v1',
          signal: controller.signal,
          // This button says a 429 itself, in the operator's language; without
          // this the interceptor also toasts the backend's English (#331).
          headers: { [SKIP_INTERCEPTOR_HEADER]: ['429'] },
        });
        tested.push(...res.data.results);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      // The backend's own reason (a 403, a 413), not axios's "Request failed
      // with status code N".
      const limited = probeLimitKey(err);
      setError(
        limited
          // eslint-disable-next-line local/readable-key -- one of the two keys probeLimitKey spells
          ? t(limited)
          : describeError(err, t('form.upstreams.testConnection.failure'))
      );
    } finally {
      if (!controller.signal.aborted) {
        setResults(tested.length > 0 ? tested : null);
        setLoading(false);
      }
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
      // Not tried either, and for a reason the operator can act on: the
      // dashboard was at its ceiling and this node's turn never came (#310).
      case 'not_tested':
        return {
          color: 'yellow',
          Icon: IconWarning,
          label: t('form.upstreams.testConnection.notTestedTimeout'),
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
    // Named, so what it answers can be told from the other alerts around it.
    <Stack gap="xs" mt="xs" role="region" aria-label={t('form.upstreams.testConnection.title')}>
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

/** The connection test of the upstream form, on the nodes it holds. */
export const TestConnectionButton = () => {
  const { control } = useFormContext();
  const np = useNamePrefix();
  const nodes = useWatch({ control, name: np('nodes') });
  const scheme = useWatch({ control, name: np('scheme') });
  return <ConnectionTest nodes={nodes} scheme={scheme} />;
};
