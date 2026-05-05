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
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Drawer,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type RouteTestResponse, testRoute } from '@/apis/route-test';
import IconAdd from '~icons/material-symbols/add';
import IconDelete from '~icons/material-symbols/close';
import IconSend from '~icons/material-symbols/send';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

type HeaderRow = { key: string; value: string };

type RouteTestDrawerProps = {
  opened: boolean;
  onClose: () => void;
  defaultPath?: string;
  defaultMethod?: string;
  defaultHost?: string;
};

const statusColor = (status: number): string => {
  if (status >= 200 && status < 300) return 'green';
  if (status >= 300 && status < 400) return 'blue';
  if (status >= 400 && status < 500) return 'orange';
  return 'red';
};

const formatBody = (body: string): string => {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

export const RouteTestDrawer = ({
  opened,
  onClose,
  defaultPath = '/',
  defaultMethod = 'GET',
  defaultHost,
}: RouteTestDrawerProps) => {
  const { t } = useTranslation();
  const [method, setMethod] = useState(defaultMethod);
  const [path, setPath] = useState(defaultPath);
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [body, setBody] = useState('');
  const [queryParams, setQueryParams] = useState<HeaderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<RouteTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>('headers');
  const [responseTab, setResponseTab] = useState<string | null>('body');
  const headersRef = useRef(headers);
  headersRef.current = headers;

  useEffect(() => {
    if (opened) {
      setPath(defaultPath);
      setMethod(defaultMethod);
      setResponse(null);
      setError(null);
      if (defaultHost) {
        const existing = headersRef.current.find((h) => h.key.toLowerCase() === 'host');
        if (!existing) {
          setHeaders((prev) => [...prev, { key: 'Host', value: defaultHost }]);
        }
      }
    }
  }, [opened, defaultPath, defaultMethod, defaultHost]);

  const handleSend = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const headerMap: Record<string, string> = {};
      for (const h of headers) {
        if (h.key.trim()) headerMap[h.key.trim()] = h.value;
      }
      const queryMap: Record<string, string> = {};
      for (const q of queryParams) {
        if (q.key.trim()) queryMap[q.key.trim()] = q.value;
      }
      const result = await testRoute({
        method,
        path,
        headers: Object.keys(headerMap).length > 0 ? headerMap : undefined,
        body: body.trim() || undefined,
        query: Object.keys(queryMap).length > 0 ? queryMap : undefined,
      });
      setResponse(result);
      setResponseTab('body');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e?.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [method, path, headers, body, queryParams]);

  const addHeader = () => setHeaders((prev) => [...prev, { key: '', value: '' }]);
  const removeHeader = (i: number) => setHeaders((prev) => prev.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setHeaders((prev) => prev.map((h, idx) => (idx === i ? { ...h, [field]: val } : h)));

  const addQuery = () => setQueryParams((prev) => [...prev, { key: '', value: '' }]);
  const removeQuery = (i: number) => setQueryParams((prev) => prev.filter((_, idx) => idx !== i));
  const updateQuery = (i: number, field: 'key' | 'value', val: string) =>
    setQueryParams((prev) => prev.map((q, idx) => (idx === i ? { ...q, [field]: val } : q)));

  const showBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={<Text fw={600}>{t('form.routeTest.title')}</Text>}
      position="right"
      size="xl"
      styles={{
        body: { height: 'calc(100% - 60px)', display: 'flex', flexDirection: 'column', padding: 0 },
        header: { borderBottom: '1px solid var(--border-light)' },
      }}
    >
      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="md">
          {/* Method + Path */}
          <Group gap="xs" align="flex-end">
            <Select
              data={HTTP_METHODS}
              value={method}
              onChange={(v) => v && setMethod(v)}
              w={120}
              label={t('form.routes.methods')}
              size="sm"
            />
            <TextInput
              value={path}
              onChange={(e) => setPath(e.target.value)}
              label={t('form.routes.uri')}
              placeholder="/api/v1/resource"
              style={{ flex: 1 }}
              size="sm"
            />
            <Button
              onClick={handleSend}
              loading={loading}
              leftSection={<IconSend width="16" height="16" />}
              size="sm"
            >
              {t('form.routeTest.send')}
            </Button>
          </Group>

          {/* Request config tabs */}
          <Tabs value={activeTab} onChange={setActiveTab}>
            <Tabs.List>
              <Tabs.Tab value="headers">
                {t('form.routeTest.headers')} {headers.filter((h) => h.key.trim()).length > 0 && (
                  <Badge size="xs" variant="light" ml={4}>{headers.filter((h) => h.key.trim()).length}</Badge>
                )}
              </Tabs.Tab>
              <Tabs.Tab value="query">
                {t('form.routeTest.query')} {queryParams.filter((q) => q.key.trim()).length > 0 && (
                  <Badge size="xs" variant="light" ml={4}>{queryParams.filter((q) => q.key.trim()).length}</Badge>
                )}
              </Tabs.Tab>
              {showBody && <Tabs.Tab value="body">{t('form.routeTest.body')}</Tabs.Tab>}
            </Tabs.List>

            <Tabs.Panel value="headers" pt="xs">
              <Stack gap="xs">
                {headers.map((h, i) => (
                  <Group key={i} gap="xs">
                    <TextInput
                      value={h.key}
                      onChange={(e) => updateHeader(i, 'key', e.target.value)}
                      size="xs"
                      style={{ flex: 1 }}
                    />
                    <TextInput
                      value={h.value}
                      onChange={(e) => updateHeader(i, 'value', e.target.value)}
                      size="xs"
                      style={{ flex: 2 }}
                    />
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => removeHeader(i)}>
                      <IconDelete width="14" height="14" />
                    </ActionIcon>
                  </Group>
                ))}
                <Button
                  variant="subtle"
                  size="compact-xs"
                  leftSection={<IconAdd width="14" height="14" />}
                  onClick={addHeader}
                  w="fit-content"
                >
                  {t('form.routeTest.addHeader')}
                </Button>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="query" pt="xs">
              <Stack gap="xs">
                {queryParams.map((q, i) => (
                  <Group key={i} gap="xs">
                    <TextInput
                      value={q.key}
                      onChange={(e) => updateQuery(i, 'key', e.target.value)}
                      size="xs"
                      style={{ flex: 1 }}
                    />
                    <TextInput
                      value={q.value}
                      onChange={(e) => updateQuery(i, 'value', e.target.value)}
                      size="xs"
                      style={{ flex: 2 }}
                    />
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => removeQuery(i)}>
                      <IconDelete width="14" height="14" />
                    </ActionIcon>
                  </Group>
                ))}
                <Button
                  variant="subtle"
                  size="compact-xs"
                  leftSection={<IconAdd width="14" height="14" />}
                  onClick={addQuery}
                  w="fit-content"
                >
                  {t('form.routeTest.addParameter')}
                </Button>
              </Stack>
            </Tabs.Panel>

            {showBody && (
              <Tabs.Panel value="body" pt="xs">
                <Textarea
                  placeholder='{"key": "value"}'
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  minRows={6}
                  maxRows={12}
                  autosize
                  styles={{ input: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13 } }}
                />
              </Tabs.Panel>
            )}
          </Tabs>

          <Divider />

          {/* Response section */}
          <Text fw={600} size="sm">{t('form.routeTest.response')}</Text>

          {error && (
            <Paper p="sm" withBorder bg="var(--mantine-color-red-0)">
              <Text size="sm" c="red">{error}</Text>
            </Paper>
          )}

          {response && (
            <Stack gap="sm">
              {/* Status bar */}
              <Group gap="md">
                <Badge
                  size="lg"
                  variant="light"
                  color={statusColor(response.status)}
                >
                  {response.status} {response.status_text}
                </Badge>
                <Text size="xs" c="dimmed">
                  {`${response.duration_ms}ms`}
                </Text>
              </Group>

              <Tabs value={responseTab} onChange={setResponseTab}>
                <Tabs.List>
                  <Tabs.Tab value="body">{t('form.routeTest.body')}</Tabs.Tab>
                  <Tabs.Tab value="headers">
                    {t('form.routeTest.headers')} {response.headers && (
                      <Badge size="xs" variant="light" ml={4}>
                        {Object.keys(response.headers).length}
                      </Badge>
                    )}
                  </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="body" pt="xs">
                  <Box
                    style={{
                      maxHeight: 400,
                      overflow: 'auto',
                      borderRadius: 'var(--mantine-radius-sm)',
                    }}
                  >
                    <Code block style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                      {formatBody(response.body)}
                    </Code>
                  </Box>
                </Tabs.Panel>

                <Tabs.Panel value="headers" pt="xs">
                  <Table size="sm" striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('form.routeTest.header')}</Table.Th>
                        <Table.Th>{t('form.routeTest.value')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {response.headers && Object.entries(response.headers).map(([key, values]) => (
                        <Table.Tr key={key}>
                          <Table.Td>
                            <Text size="xs" ff="monospace" fw={500}>{key}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" ff="monospace">{Array.isArray(values) ? values.join(', ') : values}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Tabs.Panel>
              </Tabs>
            </Stack>
          )}

          {!response && !error && !loading && (
            <Paper p="xl" withBorder ta="center">
              <Text c="dimmed" size="sm">
                {t('form.routeTest.emptyResponse')}
              </Text>
            </Paper>
          )}
        </Stack>
      </ScrollArea>
    </Drawer>
  );
};
