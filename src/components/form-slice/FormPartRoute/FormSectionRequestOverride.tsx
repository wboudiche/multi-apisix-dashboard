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
  Group,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { APISIX } from '@/types/schema/apisix';
import IconAdd from '~icons/material-symbols/add';
import IconDelete from '~icons/material-symbols/delete-outline';

import { FormSection } from '../FormSection';

type HeaderRow = { key: string; value: string };

type ProxyRewriteConfig = {
  scheme?: string;
  uri?: string;
  regex_uri?: string[];
  host?: string;
  method?: string;
  headers?: {
    add?: Record<string, string>;
    set?: Record<string, string>;
    remove?: string[];
  };
};

type UriMode = 'keep' | 'static' | 'regex';

const parseConfig = (config: ProxyRewriteConfig | undefined) => {
  if (!config) {
    return {
      schemeMode: 'keep' as const,
      scheme: '',
      uriMode: 'keep' as UriMode,
      staticUri: '',
      regexPattern: '',
      regexTemplate: '',
      hostMode: 'keep' as const,
      host: '',
      method: '',
      setHeaders: [] as HeaderRow[],
      removeHeaders: [] as string[],
    };
  }

  let uriMode: UriMode = 'keep';
  if (config.regex_uri?.length) uriMode = 'regex';
  else if (config.uri) uriMode = 'static';

  const setHeaders: HeaderRow[] = [];
  if (config.headers?.set) {
    for (const [k, v] of Object.entries(config.headers.set)) {
      setHeaders.push({ key: k, value: v });
    }
  }
  if (config.headers?.add) {
    for (const [k, v] of Object.entries(config.headers.add)) {
      setHeaders.push({ key: k, value: v });
    }
  }

  return {
    schemeMode: config.scheme ? 'override' : 'keep',
    scheme: config.scheme || '',
    uriMode,
    staticUri: config.uri || '',
    regexPattern: config.regex_uri?.[0] || '',
    regexTemplate: config.regex_uri?.[1] || '',
    hostMode: config.host ? 'override' : 'keep',
    host: config.host || '',
    method: config.method || '',
    setHeaders,
    removeHeaders: config.headers?.remove || [],
  };
};

const buildConfig = (state: ReturnType<typeof parseConfig>): ProxyRewriteConfig | null => {
  const config: ProxyRewriteConfig = {};
  let hasAny = false;

  if (state.schemeMode === 'override' && state.scheme) {
    config.scheme = state.scheme;
    hasAny = true;
  }

  if (state.uriMode === 'static' && state.staticUri) {
    config.uri = state.staticUri;
    hasAny = true;
  } else if (state.uriMode === 'regex' && state.regexPattern) {
    config.regex_uri = [state.regexPattern, state.regexTemplate || '/$1'];
    hasAny = true;
  }

  if (state.hostMode === 'override' && state.host) {
    config.host = state.host;
    hasAny = true;
  }

  if (state.method) {
    config.method = state.method;
    hasAny = true;
  }

  const headers: ProxyRewriteConfig['headers'] = {};
  if (state.setHeaders.length > 0) {
    const set: Record<string, string> = {};
    for (const h of state.setHeaders) {
      if (h.key) {
        set[h.key] = h.value;
        hasAny = true;
      }
    }
    if (Object.keys(set).length > 0) headers.set = set;
  }
  if (state.removeHeaders.length > 0) {
    headers.remove = state.removeHeaders;
    hasAny = true;
  }
  if (Object.keys(headers).length > 0) {
    config.headers = headers;
  }

  return hasAny ? config : null;
};

export const FormSectionRequestOverride = () => {
  const { t } = useTranslation();
  const { setValue, getValues, formState } = useFormContext();
  const plugins = useWatch({ name: 'plugins' });
  const isReadOnly = formState.disabled;

  const [state, setState] = useState(() =>
    parseConfig((getValues('plugins') as Record<string, unknown>)?.['proxy-rewrite'] as ProxyRewriteConfig | undefined)
  );
  const [initialized, setInitialized] = useState(false);

  // Sync from form to local state on mount / external plugin editor changes
  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      return;
    }
    const current = (plugins as Record<string, unknown>)?.['proxy-rewrite'] as ProxyRewriteConfig | undefined;
    if (current) {
      setState(parseConfig(current));
    }
  }, [plugins?.['proxy-rewrite']]);

  // Sync from local state to form
  const syncToForm = useCallback(
    (newState: ReturnType<typeof parseConfig>) => {
      setState(newState);
      const currentPlugins = (getValues('plugins') || {}) as Record<string, unknown>;
      const config = buildConfig(newState);
      if (config) {
        setValue('plugins', { ...currentPlugins, 'proxy-rewrite': config }, { shouldDirty: true });
      } else {
        const { 'proxy-rewrite': _, ...rest } = currentPlugins;
        setValue('plugins', rest, { shouldDirty: true });
      }
    },
    [getValues, setValue]
  );

  const update = (patch: Partial<ReturnType<typeof parseConfig>>) => {
    syncToForm({ ...state, ...patch });
  };

  const hasOverrides = state.schemeMode !== 'keep' || state.uriMode !== 'keep' ||
    state.hostMode !== 'keep' || state.method || state.setHeaders.length > 0 || state.removeHeaders.length > 0;

  if (isReadOnly && !hasOverrides) return null;

  return (
    <FormSection legend={t('form.requestOverride.title')}>
      <Text size="xs" c="dimmed" mb="sm">
        {t('form.requestOverride.syncNotice')}
      </Text>

      {/* Scheme Override */}
      <Radio.Group
        label={t('form.requestOverride.scheme')}
        value={state.schemeMode === 'keep' ? 'keep' : state.scheme}
        onChange={(val) => {
          if (val === 'keep') {
            update({ schemeMode: 'keep', scheme: '' });
          } else {
            update({ schemeMode: 'override', scheme: val });
          }
        }}
      >
        <Group mt="xs">
          <Radio value="keep" label={t('form.requestOverride.keepOriginal')} disabled={isReadOnly} />
          <Radio value="http" label="HTTP" disabled={isReadOnly} />
          <Radio value="https" label="HTTPS" disabled={isReadOnly} />
        </Group>
      </Radio.Group>

      {/* URI Override */}
      <Radio.Group
        label={t('form.requestOverride.uri')}
        value={state.uriMode}
        onChange={(val) => {
          update({ uriMode: val as UriMode, staticUri: '', regexPattern: '', regexTemplate: '' });
        }}
      >
        <Group mt="xs">
          <Radio value="keep" label={t('form.requestOverride.keepOriginal')} disabled={isReadOnly} />
          <Radio value="static" label={t('form.requestOverride.uriStatic')} disabled={isReadOnly} />
          <Radio value="regex" label={t('form.requestOverride.uriRegex')} disabled={isReadOnly} />
        </Group>
      </Radio.Group>
      {state.uriMode === 'static' && (
        <TextInput
          placeholder="/new/path"
          value={state.staticUri}
          onChange={(e) => update({ staticUri: e.currentTarget.value })}
          disabled={isReadOnly}
        />
      )}
      {state.uriMode === 'regex' && (
        <Group grow>
          <TextInput
            label={t('form.requestOverride.regexPattern')}
            placeholder="^/old/(.*)"
            value={state.regexPattern}
            onChange={(e) => update({ regexPattern: e.currentTarget.value })}
            disabled={isReadOnly}
          />
          <TextInput
            label={t('form.requestOverride.regexTemplate')}
            placeholder="/new/$1"
            value={state.regexTemplate}
            onChange={(e) => update({ regexTemplate: e.currentTarget.value })}
            disabled={isReadOnly}
          />
        </Group>
      )}

      {/* Host Override */}
      <Radio.Group
        label={t('form.requestOverride.host')}
        value={state.hostMode}
        onChange={(val) => {
          update({ hostMode: val as 'keep' | 'override', host: '' });
        }}
      >
        <Group mt="xs">
          <Radio value="keep" label={t('form.requestOverride.keepOriginal')} disabled={isReadOnly} />
          <Radio value="override" label={t('form.requestOverride.hostStatic')} disabled={isReadOnly} />
        </Group>
      </Radio.Group>
      {state.hostMode === 'override' && (
        <TextInput
          placeholder="new-host.example.com"
          value={state.host}
          onChange={(e) => update({ host: e.currentTarget.value })}
          disabled={isReadOnly}
        />
      )}

      {/* Method Override */}
      <Select
        label={t('form.requestOverride.method')}
        placeholder={t('form.requestOverride.keepOriginal')}
        data={APISIX.HttpMethod.options.map((v) => v.value)}
        value={state.method || null}
        onChange={(val) => update({ method: val || '' })}
        clearable
        disabled={isReadOnly}
      />

      {/* Header Override */}
      <Stack gap="xs">
        <Text size="sm" fw={500}>{t('form.requestOverride.headers')}</Text>
        {state.setHeaders.map((h, i) => (
          <Group key={i} gap="xs">
            <TextInput
              placeholder={t('form.requestOverride.headerKey')}
              value={h.key}
              onChange={(e) => {
                const next = [...state.setHeaders];
                next[i] = { ...next[i], key: e.currentTarget.value };
                update({ setHeaders: next });
              }}
              style={{ flex: 1 }}
              disabled={isReadOnly}
            />
            <TextInput
              placeholder={t('form.requestOverride.headerValue')}
              value={h.value}
              onChange={(e) => {
                const next = [...state.setHeaders];
                next[i] = { ...next[i], value: e.currentTarget.value };
                update({ setHeaders: next });
              }}
              style={{ flex: 1 }}
              disabled={isReadOnly}
            />
            {!isReadOnly && (
              <ActionIcon
                color="red"
                variant="subtle"
                onClick={() => {
                  update({ setHeaders: state.setHeaders.filter((_, j) => j !== i) });
                }}
              >
                <IconDelete width="16" height="16" />
              </ActionIcon>
            )}
          </Group>
        ))}
        {!isReadOnly && (
          <Group>
            <ActionIcon
              variant="light"
              onClick={() => update({ setHeaders: [...state.setHeaders, { key: '', value: '' }] })}
            >
              <IconAdd width="16" height="16" />
            </ActionIcon>
            <Text size="xs" c="dimmed">{t('form.requestOverride.addHeader')}</Text>
          </Group>
        )}
      </Stack>
    </FormSection>
  );
};
