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
import { Alert, Button, Code, Paper, Radio, Stack, Text, TextInput, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { OidcRouteContext } from '@/utils/keycloak-client';
import {
  checkDiscovery,
  type DiscoveryCheck,
  isAbsoluteHttpUrl,
  oidcMode,
  redirectUriProblem,
  withOidcMode,
} from '@/utils/oidc';

import { KeycloakClientPicker } from './KeycloakClientPicker';

/** The provider's configuration could not be fetched from this page. */
class Unreachable extends Error {}
/** It was fetched, and is not an OpenID configuration. */
class NotDiscovery extends Error {}
/**
 * Not an http or https address: fetched as it is, it would be read against
 * this page's own server, and the provider blamed for its answer.
 */
class NotAbsolute extends Error {}

const fetchDiscovery = async (url: string): Promise<unknown> => {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      // Nothing of this page goes to the provider.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Unreachable();
  }
  if (!res.ok) throw new NotDiscovery();
  return res.json().catch(() => {
    throw new NotDiscovery();
  });
};

export type OidcSectionProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readOnly?: boolean;
  /** The route being edited: offers to make or reuse a Keycloak client for it. */
  route?: OidcRouteContext;
};

/**
 * openid-connect's form, said as the questions it asks: how callers sign
 * in - a login page or a token they already hold - in place of bearer_only,
 * and whether the provider's address answers, with what the mode chosen
 * needs from it.
 */
export const OidcSection = ({ config, onChange, readOnly, route }: OidcSectionProps) => {
  const { t } = useTranslation();
  const mode = oidcMode(config);
  const discovery = typeof config.discovery === 'string' ? config.discovery.trim() : '';
  const redirectProblem = redirectUriProblem(config);

  // The document is kept, and checked against the form as it stands: what
  // it lacks depends on the mode, which may be changed after the test.
  const test = useMutation({
    mutationFn: async (url: string) => {
      if (!isAbsoluteHttpUrl(url)) throw new NotAbsolute();
      const doc = await fetchDiscovery(url);
      if (!checkDiscovery(doc, config)) throw new NotDiscovery();
      return doc;
    },
  });
  // A result read for another address is not shown as this one's.
  const result: DiscoveryCheck | undefined =
    test.data !== undefined && test.variables === discovery
      ? (checkDiscovery(test.data, config) ?? undefined)
      : undefined;

  return (
    <Paper withBorder radius="md" p="md" data-testid="oidc-section">
      <Stack gap="sm">
        {route && !readOnly && (
          <KeycloakClientPicker config={config} onChange={onChange} route={route} />
        )}
        <Button
          variant="light"
          w="fit-content"
          disabled={!discovery}
          loading={test.isPending}
          onClick={() => test.mutate(discovery)}
        >
          {t('form.plugins.oidc.test')}
        </Button>
        {test.variables === discovery && test.isError && (
          <Alert color="red" variant="light">
            {test.error instanceof NotAbsolute
              ? t('form.plugins.oidc.notAbsolute')
              : test.error instanceof NotDiscovery
                ? t('form.plugins.oidc.notDiscovery')
                : t('form.plugins.oidc.unreachable')}
          </Alert>
        )}
        {result && (
          <Alert color={result.problems.length ? 'yellow' : 'teal'} variant="light">
            <Stack gap={4}>
              <Text size="sm">
                {t('form.plugins.oidc.found', { issuer: result.issuer })}
              </Text>
              {result.problems.includes('noAuthorization') && (
                <Text size="sm">{t('form.plugins.oidc.noAuthorization')}</Text>
              )}
              {result.problems.includes('noToken') && (
                <Text size="sm">{t('form.plugins.oidc.noToken')}</Text>
              )}
              {result.problems.includes('noKeys') && (
                <Text size="sm">{t('form.plugins.oidc.noKeys')}</Text>
              )}
              {result.problems.includes('noVerification') && (
                <Text size="sm">{t('form.plugins.oidc.noVerification')}</Text>
              )}
            </Stack>
          </Alert>
        )}

        <Title order={5}>{t('form.plugins.oidc.modeTitle')}</Title>
        <Radio.Group
          value={mode}
          onChange={(next) => onChange(withOidcMode(config, next === 'token' ? 'token' : 'login'))}
        >
          <Stack gap="xs">
            <Radio
              value="login"
              disabled={readOnly}
              label={t('form.plugins.oidc.login')}
              description={t('form.plugins.oidc.loginHelp')}
            />
            <Radio
              value="token"
              disabled={readOnly}
              label={t('form.plugins.oidc.token')}
              description={t('form.plugins.oidc.tokenHelp')}
            />
          </Stack>
        </Radio.Group>
        {mode === 'login' ? (
          <>
            <TextInput
              // eslint-disable-next-line i18next/no-literal-string -- the setting's own name
              label="redirect_uri"
              description={t('form.plugins.oidc.redirectHelp')}
              // eslint-disable-next-line i18next/no-literal-string -- an example address
              placeholder="https://gateway.example.com/app/callback"
              value={typeof config.redirect_uri === 'string' ? config.redirect_uri : ''}
              disabled={readOnly}
              onChange={(e) => {
                const next = { ...config };
                const value = e.currentTarget.value;
                if (value) next.redirect_uri = value;
                else delete next.redirect_uri;
                onChange(next);
              }}
            />
            {/* A warning, not a refusal: the gateway takes either, and a
                provider that accepts any callback works without one. Not
                for someone only looking, who cannot change it. */}
            {!readOnly && redirectProblem && (
              <Text size="xs" c="yellow.9">
                {redirectProblem === 'missing'
                  ? t('form.plugins.oidc.redirectMissing')
                  : t('form.plugins.oidc.redirectNotAbsolute')}
              </Text>
            )}
          </>
        ) : (
          <Text size="xs" c="dimmed">
            {t('form.plugins.oidc.tokenHow')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string -- an HTTP header as sent */}
            <Code>Authorization: Bearer &lt;token&gt;</Code>
          </Text>
        )}
      </Stack>
    </Paper>
  );
};
