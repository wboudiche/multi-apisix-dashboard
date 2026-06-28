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
  Button,
  Code,
  Group,
  List,
  Modal,
  Radio,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchWsdl } from '@/apis/wsdl';
import { API_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import {
  parseWsdlBundle,
  type WsdlImportMode,
  type WsdlParseResult,
} from '@/utils/wsdl-import';
import { expandWsdlZip } from '@/utils/wsdl-zip';
import IconError from '~icons/material-symbols/error-outline';
import IconUpload from '~icons/material-symbols/upload';

type ImportWsdlModalProps = {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type Bundle = { entry: string; docs: Record<string, string> };

export const ImportWsdlModal = ({ opened, onClose, onSuccess }: ImportWsdlModalProps) => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<WsdlImportMode>('per-operation');
  const [upstreamKind, setUpstreamKind] = useState<'existing' | 'auto'>('existing');
  const [upstreamId, setUpstreamId] = useState('');
  const [parseResult, setParseResult] = useState<WsdlParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setContent('');
    setUrlValue('');
    setBundle(null);
    setSourceUrl(undefined);
    setMode('per-operation');
    setUpstreamKind('existing');
    setUpstreamId('');
    setParseResult(null);
    setParseError(null);
    setSourceWarnings([]);
    setImporting(false);
    setImportResults(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const clearDerived = () => {
    setParseResult(null);
    setParseError(null);
    setSourceWarnings([]);
    setImportResults(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    clearDerived();
    setSourceUrl(undefined);
    try {
      if (/\.zip$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const out = await expandWsdlZip(buf);
        setBundle(out);
        setContent(`[ZIP] ${file.name} — ${Object.keys(out.docs).length} document(s)`);
      } else {
        const text = await file.text();
        setContent(text);
        setBundle({ entry: 'main', docs: { main: text } });
      }
    } catch (err: unknown) {
      setParseError((err as { message?: string })?.message ?? t('form.importWsdl.readError'));
    }
  };

  const handleFetchUrl = useCallback(async () => {
    clearDerived();
    setBundle(null);
    try {
      const out = await fetchWsdl(urlValue.trim());
      setBundle({ entry: out.entry, docs: out.docs });
      setSourceUrl(urlValue.trim());
      setSourceWarnings(out.warnings ?? []);
      setContent(`[URL] ${urlValue.trim()} — ${Object.keys(out.docs).length} document(s)`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setParseError(e?.response?.data?.error ?? e?.message ?? t('form.importWsdl.fetchError'));
    }
  }, [urlValue, t]);

  const effectiveBundle = (): Bundle | null => {
    if (bundle) return bundle;
    if (content.trim() && !content.startsWith('[')) return { entry: 'main', docs: { main: content } };
    return null;
  };

  const handleParse = useCallback(() => {
    clearDerived();
    const b = effectiveBundle();
    if (!b) {
      setParseError(t('form.importWsdl.noServices'));
      return;
    }
    if (upstreamKind === 'existing' && !upstreamId.trim()) {
      setParseError(t('form.importWsdl.upstreamRequired'));
      return;
    }
    try {
      const result = parseWsdlBundle(b, {
        mode,
        sourceUrl,
        upstream:
          upstreamKind === 'existing'
            ? { kind: 'existing', upstreamId: upstreamId.trim() || undefined }
            : { kind: 'auto' },
      });
      if (result.routes.length === 0) {
        setParseError(t('form.importWsdl.noServices'));
        return;
      }
      setParseResult(result);
    } catch (err: unknown) {
      setParseError((err as { message?: string })?.message ?? t('form.json.parseError'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, content, mode, sourceUrl, upstreamKind, upstreamId, t]);

  const handleImport = useCallback(async () => {
    if (!parseResult) return;
    setImporting(true);
    setImportResults(null);
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const route of parseResult.routes) {
      try {
        await req.post(API_ROUTES, route);
        success++;
      } catch (err: unknown) {
        failed++;
        const e = err as { response?: { data?: { error_msg?: string } }; message?: string };
        errors.push(`${route.name ?? route.uri}: ${e?.response?.data?.error_msg ?? e?.message ?? t('form.importWsdl.unknownError')}`);
      }
    }
    setImportResults({ success, failed, errors });
    setImporting(false);
    if (success > 0) onSuccess();
  }, [parseResult, onSuccess, t]);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={<Text fw={600}>{t('form.importWsdl.title')}</Text>}
      size="lg"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">{t('form.importWsdl.description')}</Text>

        <Tabs defaultValue="upload">
          <Tabs.List>
            <Tabs.Tab value="upload">{t('form.importWsdl.tabUpload')}</Tabs.Tab>
            <Tabs.Tab value="url">{t('form.importWsdl.tabUrl')}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="upload" pt="sm">
            <Stack gap="xs">
              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconUpload width="14" height="14" />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('form.btn.upload')}
                </Button>
                <input
                  type="file"
                  accept=".wsdl,.xml,.zip"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  ref={fileInputRef}
                />
              </Group>
              <Textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setBundle(null);
                  setSourceUrl(undefined);
                  clearDerived();
                }}
                placeholder={t('form.importWsdl.placeholder')}
                minRows={8}
                maxRows={14}
                autosize
                styles={{ input: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13 } }}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="url" pt="sm">
            <Group align="flex-end" gap="sm">
              <TextInput
                style={{ flex: 1 }}
                label={t('form.importWsdl.urlLabel')}
                placeholder={t('form.importWsdl.urlPlaceholder')}
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
              />
              <Button onClick={handleFetchUrl} disabled={!urlValue.trim()}>
                {t('form.importWsdl.fetch')}
              </Button>
            </Group>
          </Tabs.Panel>
        </Tabs>

        <Group gap="lg" align="flex-start">
          <Stack gap={4}>
            <Text size="sm" fw={500}>{t('form.importWsdl.mode')}</Text>
            <SegmentedControl
              value={mode}
              onChange={(v) => {
                setMode(v as WsdlImportMode);
                clearDerived();
              }}
              data={[
                { label: t('form.importWsdl.modePerOperation'), value: 'per-operation' },
                { label: t('form.importWsdl.modePassthrough'), value: 'passthrough' },
              ]}
            />
          </Stack>
          <Stack gap={4}>
            <Text size="sm" fw={500}>{t('form.importWsdl.upstream')}</Text>
            <Radio.Group value={upstreamKind} onChange={(v) => { setUpstreamKind(v as 'existing' | 'auto'); clearDerived(); }}>
              <Group gap="md">
                <Radio value="existing" label={t('form.importWsdl.upstreamExisting')} />
                <Radio value="auto" label={t('form.importWsdl.upstreamAuto')} />
              </Group>
            </Radio.Group>
            {upstreamKind === 'existing' && (
              <TextInput
                placeholder={t('form.importWsdl.upstreamExistingPlaceholder')}
                value={upstreamId}
                onChange={(e) => setUpstreamId(e.target.value)}
              />
            )}
          </Stack>
        </Group>

        {parseError && (
          <Alert variant="light" color="red" icon={<IconError width="16" height="16" />}>
            <Text size="sm">{parseError}</Text>
          </Alert>
        )}

        {sourceWarnings.length > 0 && (
          <Alert variant="light" color="yellow">
            <Text size="sm" fw={500}>{t('form.importWsdl.warningsTitle')}</Text>
            <List size="xs">
              {sourceWarnings.map((w, i) => (
                <List.Item key={i}>{w}</List.Item>
              ))}
            </List>
          </Alert>
        )}

        {parseResult && !importResults && (
          <Stack gap="sm">
            <Group gap="sm">
              <Badge variant="light">{parseResult.soapVersion}</Badge>
              <Text size="sm" fw={500}>
                {t('form.importWsdl.servicesFound', {
                  services: parseResult.serviceCount,
                  operations: parseResult.operationCount,
                })}
              </Text>
            </Group>
            {parseResult.warnings.length > 0 && (
              <Alert variant="light" color="yellow">
                <Text size="sm" fw={500}>{t('form.importWsdl.warningsTitle')}</Text>
                <List size="xs">
                  {parseResult.warnings.map((w, i) => (
                    <List.Item key={i}>{w}</List.Item>
                  ))}
                </List>
              </Alert>
            )}
            <ScrollArea.Autosize mah={200}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('form.basic.name')}</Table.Th>
                    <Table.Th>{t('form.routes.uri')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {parseResult.routes.map((route, i) => (
                    <Table.Tr key={i}>
                      <Table.Td><Text size="xs">{route.name ?? '-'}</Text></Table.Td>
                      <Table.Td><Code>{route.uri}</Code></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </Stack>
        )}

        {importResults && (
          <Stack gap="xs">
            {importResults.success > 0 && (
              <Alert variant="light" color="green">
                <Text size="sm">{t('form.importWsdl.successCount', { count: importResults.success })}</Text>
              </Alert>
            )}
            {importResults.failed > 0 && (
              <Alert variant="light" color="red">
                <Stack gap={4}>
                  <Text size="sm">{t('form.importWsdl.failedCount', { count: importResults.failed })}</Text>
                  {importResults.errors.map((err, i) => (
                    <Text key={i} size="xs" c="red">{err}</Text>
                  ))}
                </Stack>
              </Alert>
            )}
          </Stack>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" color="gray" onClick={handleClose}>
            {importResults?.success ? t('form.btn.back') : t('form.btn.cancel')}
          </Button>
          {!importResults && (
            <Button onClick={handleParse} disabled={!content.trim()}>
              {t('form.importWsdl.parse')}
            </Button>
          )}
          {parseResult && !importResults && (
            <Button onClick={handleImport} loading={importing}>
              {t('form.importWsdl.import', { count: parseResult.routes.length })}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
};
