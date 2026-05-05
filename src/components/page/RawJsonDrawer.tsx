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
import { Alert, Button, CopyButton, Drawer, Group, Text, Tooltip } from '@mantine/core';
import { Editor } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { monaco, setupMonacoEditor } from '@/utils/monaco';
import IconCheck from '~icons/material-symbols/check';
import IconCopy from '~icons/material-symbols/content-copy-outline';
import IconError from '~icons/material-symbols/error-outline';
import IconSave from '~icons/material-symbols/save-outline';

setupMonacoEditor();

type RawJsonDrawerProps = {
  opened: boolean;
  onClose: () => void;
  title: string;
  json: Record<string, unknown> | null;
  onSave?: (data: Record<string, unknown>) => Promise<void>;
  loading?: boolean;
};

export const RawJsonDrawer = ({ opened, onClose, title, json, onSave, loading }: RawJsonDrawerProps) => {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const formatted = useMemo(() => {
    if (!json) return '';
    return JSON.stringify(json, null, 2);
  }, [json]);

  useEffect(() => {
    if (opened && formatted) {
      setValue(formatted);
      setError(null);
      setSaveError(null);
    }
  }, [opened, formatted]);

  const handleEditorChange = useCallback((val: string | undefined) => {
    const v = val || '';
    setValue(v);
    try {
      JSON.parse(v);
      setError(null);
    } catch {
      setError(t('form.json.parseError'));
    }
  }, [t]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaveError(null);
    try {
      const parsed = JSON.parse(value);
      await onSave(parsed);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error_msg?: string } }; message?: string };
      setSaveError(e?.response?.data?.error_msg || e?.message || 'Failed to save');
    }
  }, [value, onSave]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      setValue(formatted);
      editorRef.current?.setValue(formatted);
      setError(null);
    } catch {
      // ignore - already showing error
    }
  }, [value]);

  const isReadOnly = !onSave;
  const isDirty = value !== formatted;

  const options = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
    minimap: { enabled: false },
    readOnly: isReadOnly,
    automaticLayout: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    lineHeight: 22,
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: isReadOnly ? 'none' : 'line',
    folding: true,
    foldingStrategy: 'indentation',
    wordWrap: 'on',
  }), [isReadOnly]);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>{title}</Text>
          {isDirty && !isReadOnly && (
            <Text size="xs" c="orange" fw={500}>{t('form.json.unsaved')}</Text>
          )}
        </Group>
      }
      position="right"
      size="xl"
      styles={{
        body: { height: 'calc(100% - 60px)', display: 'flex', flexDirection: 'column', padding: 0 },
        header: { borderBottom: '1px solid var(--border-light)' },
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          defaultLanguage="json"
          value={value}
          onChange={handleEditorChange}
          onMount={(editor) => { editorRef.current = editor; }}
          options={options}
        />
      </div>

      {(error || saveError) && (
        <Alert
          variant="light"
          color="red"
          icon={<IconError width="16" height="16" />}
          m="xs"
          p="xs"
        >
          <Text size="sm">{error || saveError}</Text>
        </Alert>
      )}

      <Group justify="space-between" p="sm" style={{ borderTop: '1px solid var(--border-light)' }}>
        <Group gap="xs">
          <CopyButton value={value}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? t('form.json.copied') : t('form.json.copy')}>
                <Button
                  variant="subtle"
                  color={copied ? 'green' : 'gray'}
                  size="compact-sm"
                  leftSection={copied ? <IconCheck width="14" height="14" /> : <IconCopy width="14" height="14" />}
                  onClick={copy}
                >
                  {copied ? t('form.json.copied') : t('form.json.copy')}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
          {!isReadOnly && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              onClick={handleFormat}
              disabled={!!error}
            >
              {t('form.json.format')}
            </Button>
          )}
        </Group>
        <Group gap="xs">
          {!isReadOnly && (
            <Button
              size="compact-sm"
              leftSection={<IconSave width="16" height="16" />}
              onClick={handleSave}
              disabled={!!error || !isDirty}
              loading={loading}
            >
              {t('form.btn.save')}
            </Button>
          )}
        </Group>
      </Group>
    </Drawer>
  );
};
