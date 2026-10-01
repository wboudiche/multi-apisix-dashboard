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
import { notifications } from '@mantine/notifications';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteListReq } from '@/apis/routes';
import { fetchWsdl } from '@/apis/wsdl';
import { API_ROUTES, PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import { probeLimitKey } from '@/utils/api-error';
import {
  type ComparableRoute,
  findRouteDuplicates,
  type RouteDuplicate,
} from '@/utils/route-duplicates';
import { proxyFailureText } from '@/utils/team-refusal';
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
  /** True while the URL is being fetched: the button says so and refuses a
      second click, which used to start a second fetch of the same graph. */
  const [fetching, setFetching] = useState(false);
  /**
   * The fetch that is current, and the way to stop it.
   *
   * A ref rather than the state above for the guard: two clicks delivered in one
   * React batch both read the state as it was rendered, so only the disabled
   * attribute stood between them. And a fetch the operator has moved on from -
   * closed the dialog, uploaded a file, pasted a document, started another one -
   * must neither land in the dialog they left nor go on holding one of the
   * dashboard's outbound slots (#310, #331, #336).
   */
  const fetchRef = useRef<{ id: number; abort: AbortController } | null>(null);
  const fetchSeq = useRef(0);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  // Set once the operator has seen the clashes, so a second click proceeds.
  const [clashesAcknowledged, setClashesAcknowledged] = useState(false);
  const [clashes, setClashes] = useState<
    { route: ComparableRoute; clashes: RouteDuplicate[] }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    abandonFetch();
    setContent('');
    setUrlValue('');
    setBundle(null);
    setSourceUrl(undefined);
    setMode('per-operation');
    setUpstreamKind('existing');
    setUpstreamId('');
    setParseResult(null);
    setParseError(null);
    setClashesAcknowledged(false);
    setClashes([]);
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
    setClashesAcknowledged(false);
    setClashes([]);
    setSourceWarnings([]);
    setImportResults(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    // This file is the source now: a fetch still running would land on top of it.
    abandonFetch();
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
    // A graph of imports can take minutes - twenty documents at ten seconds
    // apiece - and nothing said one was under way, so an operator clicked again
    // and the second call wiped what the first had built (#336). Read from the
    // ref: two clicks in one React batch see the same rendered state.
    if (fetchRef.current) return;

    const url = urlValue.trim();
    const id = ++fetchSeq.current;
    const abort = new AbortController();
    fetchRef.current = { id, abort };
    setFetching(true);
    clearDerived();
    setBundle(null);

    try {
      const out = await fetchWsdl(url, abort.signal);
      // Dropped if the operator has moved on - uploaded a file, pasted a
      // document, closed the dialog, started another fetch: landing anyway, this
      // overwrote what they did with a source they had left behind.
      if (fetchSeq.current !== id) return;
      clearDerived();
      setBundle({ entry: out.entry, docs: out.docs });
      setSourceUrl(url);
      setSourceWarnings(out.warnings ?? []);
      setContent(`[URL] ${url} — ${Object.keys(out.docs).length} document(s)`);
    } catch (err: unknown) {
      if (fetchSeq.current !== id || abort.signal.aborted) return;
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const limited = probeLimitKey(err);
      // The source goes with the failure: left behind, its marker kept Parse
      // enabled on a document that never arrived, and Parse then reported no
      // SOAP services in a WSDL nobody had.
      setContent('');
      setSourceUrl(undefined);
      setParseError(
        limited
          ? t(limited)
          : (e?.response?.data?.error ?? e?.message ?? t('form.importWsdl.fetchError'))
      );
    } finally {
      if (fetchRef.current?.id === id) {
        fetchRef.current = null;
        setFetching(false);
      }
    }
  }, [urlValue, t]);

  /** Gives up on the fetch in flight, if there is one. */
  const abandonFetch = useCallback(() => {
    fetchSeq.current += 1;
    fetchRef.current?.abort.abort();
    fetchRef.current = null;
    setFetching(false);
  }, []);

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

    // Importing the same WSDL twice used to add a second copy of every
    // operation, silently. Show what already exists before writing anything; a
    // clash is legal in APISIX, so a second click goes ahead.
    if (!clashesAcknowledged) {
      setImporting(true);
      try {
        const existing = await getRouteListReq(req, { page: 1, page_size: PAGE_SIZE_MAX });
        const found = (parseResult.routes as ComparableRoute[])
          .map((route) => ({
            route,
            clashes: findRouteDuplicates(
              existing.list.map((r) => r.value as ComparableRoute),
              route
            ),
          }))
          .filter((entry) => entry.clashes.length > 0);
        setClashesAcknowledged(true);
        if (found.length > 0) {
          setClashes(found);
          setImporting(false);
          return;
        }
      } catch {
        setClashesAcknowledged(true);
        setImporting(false);
        notifications.show({
          message: t('form.import.duplicateCheckFailed'),
          color: 'yellow',
        });
        return;
      }
    }

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
        errors.push(`${route.name ?? route.uri}: ${proxyFailureText(err) ?? t('form.importWsdl.unknownError')}`);
      }
    }
    setImportResults({ success, failed, errors });
    setImporting(false);
    if (success > 0) onSuccess();
  }, [parseResult, onSuccess, t, clashesAcknowledged]);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={<Text fw={600}>{t('form.importWsdl.title')}</Text>}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
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
                  // What is typed here is the source now, as an upload is.
                  abandonFetch();
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
              <Button
                onClick={handleFetchUrl}
                disabled={!urlValue.trim()}
                loading={fetching}
                aria-busy={fetching}
              >
                {/* Swapped rather than left to the spinner: Mantine blanks the
                    label under `loading` and hides its loader from the
                    accessibility tree, so the button would say nothing at all
                    for the minutes this can take. */}
                {fetching ? t('form.importWsdl.fetching') : t('form.importWsdl.fetch')}
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

        {clashes.length > 0 && !importResults && (
          <Alert variant="light" color="yellow">
            <Text size="sm" fw={500}>
              {t('form.import.duplicateTitle', { count: clashes.length })}
            </Text>
            <List size="sm" spacing={2} withPadding mt={4}>
              {clashes.map((entry) => (
                <List.Item key={entry.route.name || entry.route.uri}>
                  {t('form.import.duplicateItem', {
                    name: entry.route.name || entry.route.uri,
                    existing: entry.clashes.map((c) => c.name).join(', '),
                  })}
                </List.Item>
              ))}
            </List>
            <Text size="xs" mt={6}>
              {t('form.import.duplicateHint')}
            </Text>
          </Alert>
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
            <Button onClick={handleParse} disabled={!content.trim() || fetching}>
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
