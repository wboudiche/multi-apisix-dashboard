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
import { Alert, Button, Radio, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ClientCredentials, oidcClientApi } from '@/apis/idps';
import { usePermission } from '@/hooks/usePermission';
import { currentInstanceIdAtom } from '@/stores/instance';
import { describeError } from '@/utils/api-error';
import {
  applyClientCredentials,
  type OidcRouteContext,
  proposeClientIdSuffix,
  proposeRedirectUri,
} from '@/utils/keycloak-client';
import { oidcMode } from '@/utils/oidc';

type Choice = 'hand' | 'create' | 'use';

export type KeycloakClientPickerProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  route: OidcRouteContext;
};

/**
 * Where the client of an openid-connect route comes from: made in Keycloak
 * now, one the dashboard made earlier, or typed by hand (the fields below).
 * Hidden when the caller has nothing to make one with and nothing to reuse.
 */
export const KeycloakClientPicker = ({ config, onChange, route }: KeycloakClientPickerProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const instanceId = useAtomValue(currentInstanceIdAtom) ?? '';
  const { isAdmin } = usePermission();
  const mode = oidcMode(config);

  const linked = useQuery({
    queryKey: ['idps', 'linked', instanceId],
    queryFn: () => oidcClientApi.linked(instanceId),
    enabled: !!instanceId,
  });
  const clients = useQuery({
    queryKey: ['oidc-clients', instanceId],
    queryFn: () => oidcClientApi.list(instanceId),
    enabled: !!instanceId,
    retry: false,
  });

  const [choice, setChoice] = useState<Choice>('hand');
  const [picked, setPicked] = useState('');
  const [suffix, setSuffix] = useState(() => proposeClientIdSuffix(route));
  const [pkce, setPkce] = useState(true);
  const [validation, setValidation] = useState<'introspection' | 'jwks'>('introspection');
  const [clientCredentials, setClientCredentials] = useState(false);
  const [redirect, setRedirect] = useState(() => proposeRedirectUri(route.hosts, route.uris));
  const [uuid, setUuid] = useState('');
  const [filled, setFilled] = useState('');
  const [problem, setProblem] = useState('');

  // Derived values stay below the state they read.
  const creators = (linked.data ?? []).filter((p) => isAdmin || p.developers_can_create);
  // The connection picked, else the first one the caller may create with.
  const idpId = creators.find((p) => p.id === picked)?.id ?? creators[0]?.id ?? '';
  const reusable = clients.data ?? [];

  const done = (c: ClientCredentials) => {
    onChange(applyClientCredentials(config, c));
    setFilled(c.client_id);
    setProblem('');
    setChoice('hand');
    // The secret is not kept in the mutation cache.
    create.reset();
    use.reset();
  };

  const create = useMutation({
    mutationFn: () =>
      oidcClientApi.create(idpId, {
        route_id: route.id,
        client_id: suffix.trim(),
        mode,
        options:
          mode === 'login'
            ? { pkce, client_credentials: false }
            : { pkce: false, validation, client_credentials: clientCredentials },
        ...(mode === 'login' && redirect.trim() ? { redirect_uri: redirect.trim() } : {}),
      }),
    onSuccess: (c) => {
      done(c);
      queryClient.invalidateQueries({ queryKey: ['oidc-clients', instanceId] });
    },
    onError: (e) => setProblem(describeError(e, t('form.plugins.oidc.kc.createFailed'))),
  });
  const use = useMutation({
    mutationFn: () => oidcClientApi.use(instanceId, uuid),
    onSuccess: done,
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 410) {
        setProblem(t('form.plugins.oidc.kc.gone'));
        queryClient.invalidateQueries({ queryKey: ['oidc-clients', instanceId] });
        setUuid('');
      } else {
        setProblem(describeError(e, t('form.plugins.oidc.kc.useFailed')));
      }
    },
  });

  if (!creators.length && !reusable.length) return null;

  const needsRoute = !route.id;
  const canSubmit =
    !needsRoute && !!idpId && !!suffix.trim() && (mode === 'token' || !!redirect.trim());

  return (
    <Stack gap="xs" data-testid="oidc-keycloak-picker">
      <Radio.Group
        label={t('form.plugins.oidc.kc.title')}
        value={choice}
        onChange={(next) => {
          setChoice(next as Choice);
          setProblem('');
        }}
      >
        <Stack gap="xs" mt="xs">
          {creators.length > 0 && (
            <Radio value="create" label={t('form.plugins.oidc.kc.create')} />
          )}
          {reusable.length > 0 && <Radio value="use" label={t('form.plugins.oidc.kc.reuse')} />}
          <Radio value="hand" label={t('form.plugins.oidc.kc.hand')} />
        </Stack>
      </Radio.Group>

      {choice === 'create' && (
        <Stack gap="xs">
          <Select
            label={t('form.plugins.oidc.kc.provider')}
            allowDeselect={false}
            data={creators.map((p) => ({ value: p.id, label: p.name }))}
            value={idpId}
            onChange={(v) => v && setPicked(v)}
          />
          <TextInput
            label={t('form.plugins.oidc.kc.clientId')}
            description={t('form.plugins.oidc.kc.clientIdHelp')}
            value={suffix}
            onChange={(e) => setSuffix(e.currentTarget.value)}
          />
          {mode === 'login' ? (
            <>
              <Switch
                label={t('form.plugins.oidc.kc.pkce')}
                checked={pkce}
                onChange={(e) => setPkce(e.currentTarget.checked)}
              />
              <TextInput
                // eslint-disable-next-line i18next/no-literal-string -- the setting's own name
                label="redirect_uri"
                description={t('form.plugins.oidc.kc.redirectHelp')}
                value={redirect}
                onChange={(e) => setRedirect(e.currentTarget.value)}
              />
            </>
          ) : (
            <>
              <Radio.Group
                label={t('form.plugins.oidc.kc.validation')}
                value={validation}
                onChange={(v) => setValidation(v === 'jwks' ? 'jwks' : 'introspection')}
              >
                <Stack gap="xs" mt="xs">
                  <Radio value="introspection" label={t('form.plugins.oidc.kc.introspection')} />
                  <Radio value="jwks" label={t('form.plugins.oidc.kc.jwks')} />
                </Stack>
              </Radio.Group>
              <Switch
                label={t('form.plugins.oidc.kc.clientCredentials')}
                checked={clientCredentials}
                onChange={(e) => setClientCredentials(e.currentTarget.checked)}
              />
            </>
          )}
          {needsRoute && <Text size="xs" c="dimmed">{t('form.plugins.oidc.kc.saveFirst')}</Text>}
          <Button
            w="fit-content"
            disabled={!canSubmit}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            {t('form.plugins.oidc.kc.createBtn')}
          </Button>
        </Stack>
      )}

      {choice === 'use' && (
        <Stack gap="xs">
          <Select
            label={t('form.plugins.oidc.kc.pick')}
            placeholder={t('form.plugins.oidc.kc.pickPlaceholder')}
            searchable
            data={reusable.map((c) => ({
              value: c.uuid,
              label: `${c.client_id} - ${c.idp_name}`,
            }))}
            value={uuid || null}
            onChange={(v) => setUuid(v ?? '')}
          />
          <Button
            w="fit-content"
            disabled={!uuid}
            loading={use.isPending}
            onClick={() => use.mutate()}
          >
            {t('form.plugins.oidc.kc.useBtn')}
          </Button>
        </Stack>
      )}

      {problem && (
        <Alert color="red" variant="light">
          {problem}
        </Alert>
      )}
      {filled && !problem && (
        <Alert color="teal" variant="light">
          {t('form.plugins.oidc.kc.filled', { id: filled })}
        </Alert>
      )}
    </Stack>
  );
};
