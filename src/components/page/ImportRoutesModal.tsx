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
  ScrollArea,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteListReq } from '@/apis/routes';
import { API_ROUTES, PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import { parseImportData,type ParseResult } from '@/utils/openapi-import';
import {
  type ComparableRoute,
  findRouteDuplicates,
  type RouteDuplicate,
} from '@/utils/route-duplicates';
import IconError from '~icons/material-symbols/error-outline';
import IconUpload from '~icons/material-symbols/upload';

type ImportRoutesModalProps = {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

/**
 * Existing routes each incoming route would clash with.
 *
 * Re-importing the same spec used to create a second copy of every route in it,
 * silently. A clash is legal in APISIX, so this informs rather than blocks —
 * but the operator has to see it before anything is written.
 */
const findImportClashes = (
  incoming: ComparableRoute[],
  existing: ComparableRoute[]
): { route: ComparableRoute; clashes: RouteDuplicate[] }[] =>
  incoming
    .map((route) => ({ route, clashes: findRouteDuplicates(existing, route) }))
    .filter((entry) => entry.clashes.length > 0);

export const ImportRoutesModal = ({ opened, onClose, onSuccess }: ImportRoutesModalProps) => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set once the operator has been shown the clashes, so a second click proceeds.
  const [clashesAcknowledged, setClashesAcknowledged] = useState(false);
  const [clashes, setClashes] = useState<
    { route: ComparableRoute; clashes: RouteDuplicate[] }[]
  >([]);

  const reset = () => {
    setContent('');
    setParseResult(null);
    setParseError(null);
    setImporting(false);
    setImportResults(null);
    setClashesAcknowledged(false);
    setClashes([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleParse = useCallback(() => {
    setParseError(null);
    setParseResult(null);
    setImportResults(null);
    try {
      const result = parseImportData(content);
      if (result.routes.length === 0) {
        setParseError(t('form.import.noRoutes'));
        return;
      }
      setParseResult(result);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setParseError(e?.message || t('form.json.parseError'));
    }
  }, [content, t]);

  const handleImport = useCallback(async () => {
    if (!parseResult) return;

    // Check against what is already on the gateway before writing anything.
    if (!clashesAcknowledged) {
      setImporting(true);
      try {
        const existing = await getRouteListReq(req, { page: 1, page_size: PAGE_SIZE_MAX });
        const found = findImportClashes(
          parseResult.routes as ComparableRoute[],
          existing.list.map((r) => r.value as ComparableRoute)
        );
        if (found.length > 0) {
          setClashes(found);
          setClashesAcknowledged(true);
          setImporting(false);
          return;
        }
      } catch {
        // The list could not be read. Say so rather than importing blind, and
        // let a second click go ahead.
        setClashesAcknowledged(true);
        setImporting(false);
        notifications.show({
          message: t('form.import.duplicateCheckFailed'),
          color: 'yellow',
        });
        return;
      }
      setClashesAcknowledged(true);
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
        const e = err as { response?: { data?: { error_msg?: string } }; message?: string };
        const name = route.name || route.uri;
        const msg = e?.response?.data?.error_msg || e?.message || 'Unknown error';
        errors.push(`${name}: ${msg}`);
      }
    }

    setImportResults({ success, failed, errors });
    setImporting(false);

    if (success > 0) {
      onSuccess();
    }
  }, [parseResult, onSuccess, clashesAcknowledged, t]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setContent(text);
      setParseResult(null);
      setParseError(null);
      setImportResults(null);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={<Text fw={600}>{t('form.import.title')}</Text>}
      size="lg"
    >
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">{t('form.import.description')}</Text>
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
            accept=".json,.yaml,.yml"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            ref={fileInputRef}
          />
        </Group>

        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setParseResult(null);
            setParseError(null);
            setImportResults(null);
          }}
          placeholder={t('form.import.placeholder')}
          minRows={10}
          maxRows={16}
          autosize
          styles={{ input: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13 } }}
        />

        {parseError && (
          <Alert variant="light" color="red" icon={<IconError width="16" height="16" />}>
            <Text size="sm">{parseError}</Text>
          </Alert>
        )}

        {parseResult && !importResults && (
          <Stack gap="sm">
            <Group gap="sm">
              <Badge variant="light">{parseResult.format}</Badge>
              <Text size="sm" fw={500}>
                {t('form.import.routesFound', { count: parseResult.routes.length })}
              </Text>
            </Group>
            <ScrollArea.Autosize mah={200}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('form.basic.name')}</Table.Th>
                    <Table.Th>{t('form.routes.uri')}</Table.Th>
                    <Table.Th>{t('form.routes.methods')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {parseResult.routes.map((route, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Text size="xs">{route.name || '-'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Code>{route.uri}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{route.methods?.join(', ') || '*'}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </Stack>
        )}

        {clashes.length > 0 && !importResults && (
          <Alert variant="light" color="yellow" icon={<IconError width="16" height="16" />}>
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
                <Text size="sm">
                  {t('form.import.successCount', { count: importResults.success })}
                </Text>
              </Alert>
            )}
            {importResults.failed > 0 && (
              <Alert variant="light" color="red">
                <Stack gap={4}>
                  <Text size="sm">
                    {t('form.import.failedCount', { count: importResults.failed })}
                  </Text>
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
          {!parseResult && !importResults && (
            <Button onClick={handleParse} disabled={!content.trim()}>
              {t('form.import.parse')}
            </Button>
          )}
          {parseResult && !importResults && (
            <Button onClick={handleImport} loading={importing}>
              {t('form.import.importRoutes', { count: parseResult.routes.length })}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
};
