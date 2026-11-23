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
import { Anchor, Radio, Select, Stack, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import type { LinkedIdp, OidcClientItem } from '@/apis/idps';
import { errorText } from '@/utils/error-text';

import type { KeycloakChoice } from './quick-create';

type Props = {
  choice: KeycloakChoice;
  onChange: (next: KeycloakChoice) => void;
  /** The connections the caller may create a client with. */
  creators: LinkedIdp[];
  /** The token clients the caller may reuse. */
  reusable: OidcClientItem[];
  /** The suffix a new client gets until one is typed. */
  proposedSuffix: string;
  /** The access error to show, a key; none until the form is submitted. */
  error?: string;
  /** To the advanced form, for a browser login. */
  onAdvanced: () => void;
};

/**
 * The quick page's Keycloak token: a client made with the route, or one the
 * dashboard made earlier. The route takes only its client's tokens; a browser
 * login is the advanced form's.
 */
export const QuickKeycloakSection = ({
  choice,
  onChange,
  creators,
  reusable,
  proposedSuffix,
  error,
  onAdvanced,
}: Props) => {
  const { t } = useTranslation();
  const shown = error ? errorText(error) : undefined;

  const switchKind = (kind: string) => {
    if (kind === choice.kind) return;
    onChange(
      kind === 'create'
        ? { kind: 'create', idpId: creators[0]?.id ?? '', suffix: proposedSuffix, validation: 'jwks' }
        : { kind: 'reuse', uuid: '' }
    );
  };

  return (
    <Stack gap="xs" data-testid="quick-keycloak-section">
      {(creators.length > 0 || choice.kind === 'create') && (
        <Radio.Group
          aria-label={t('form.quickRoute.accessKeycloak')}
          value={choice.kind}
          onChange={switchKind}
        >
          <Stack gap="xs">
            {creators.length > 0 && <Radio value="create" label={t('form.quickRoute.keycloak.create')} />}
            <Radio value="reuse" label={t('form.quickRoute.keycloak.reuse')} />
          </Stack>
        </Radio.Group>
      )}

      {choice.kind === 'create' && (
        <Stack gap="xs">
          {/* One connection is the one: nothing to pick. */}
          {creators.length > 1 && (
            <Select
              label={t('form.quickRoute.keycloak.connection')}
              allowDeselect={false}
              data={creators.map((p) => ({ value: p.id, label: p.name }))}
              value={choice.idpId || null}
              onChange={(v) => v && onChange({ ...choice, idpId: v })}
              error={choice.idpId ? undefined : shown}
            />
          )}
          <TextInput
            label={t('form.quickRoute.keycloak.clientId')}
            description={t('form.plugins.oidc.kc.clientIdHelp')}
            required
            value={choice.suffix}
            onChange={(e) => onChange({ ...choice, suffix: e.currentTarget.value })}
            error={choice.idpId ? shown : undefined}
          />
          <Radio.Group
            label={t('form.quickRoute.keycloak.validation')}
            value={choice.validation}
            onChange={(v) => onChange({ ...choice, validation: v === 'introspection' ? 'introspection' : 'jwks' })}
          >
            <Stack gap="xs" mt="xs">
              <Radio value="jwks" label={t('form.quickRoute.keycloak.jwks')} />
              <Radio value="introspection" label={t('form.quickRoute.keycloak.introspection')} />
            </Stack>
          </Radio.Group>
        </Stack>
      )}

      {choice.kind === 'reuse' && (
        <Select
          label={t('form.quickRoute.keycloak.client')}
          placeholder={t('form.plugins.oidc.kc.pickPlaceholder')}
          searchable
          data={reusable.map((c) => ({ value: c.uuid, label: `${c.client_id} - ${c.idp_name}` }))}
          value={choice.uuid || null}
          onChange={(v) => onChange({ kind: 'reuse', uuid: v ?? '' })}
          error={shown}
        />
      )}

      <Anchor component="button" type="button" size="xs" onClick={onAdvanced} w="fit-content">
        {t('form.quickRoute.keycloak.loginHint')}
      </Anchor>
    </Stack>
  );
};
