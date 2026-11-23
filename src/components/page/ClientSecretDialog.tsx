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
import { Button, Code, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { CopyValue } from '@/components/form-slice/FormItemPlugins/AuthClientsSection';
import { tokenEndpoint } from '@/utils/keycloak-client';

/** What the dialog shows of a client just made; the secret lives here only while it is open. */
export type ShownClient = { client_id: string; client_secret: string; discovery: string };

type Props = {
  /** None: closed. */
  client: ShownClient | null;
  onClose: () => void;
};

const Row = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Stack gap={4}>
    <Text size="sm" fw={500}>
      {label}
    </Text>
    <Group gap="xs" wrap="nowrap">
      <Code style={{ flex: 1, wordBreak: 'break-all' }} aria-label={label}>
        {value}
      </Code>
      <CopyValue value={value} />
    </Group>
    {hint && (
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    )}
  </Stack>
);

/**
 * The client a route was made with, shown once: the caller's application
 * needs its id and secret to get a token, and the dashboard keeps no secret.
 * Closed only by its button - a click beside it would lose the secret.
 */
export const ClientSecretDialog = ({ client, onClose }: Props) => {
  const { t } = useTranslation();
  return (
    <Modal
      opened={client !== null}
      onClose={onClose}
      title={t('form.quickRoute.keycloak.secretTitle')}
      centered
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      data-testid="quick-keycloak-secret-dialog"
    >
      {client && (
        <Stack gap="md">
          <Text size="sm" c="orange">
            {t('form.quickRoute.keycloak.secretOnce')}
          </Text>
          <Row label={t('form.quickRoute.keycloak.clientId')} value={client.client_id} />
          <Row label={t('form.quickRoute.keycloak.clientSecret')} value={client.client_secret} />
          <Row
            label={t('form.quickRoute.keycloak.tokenEndpoint')}
            value={tokenEndpoint(client.discovery)}
            hint={t('form.quickRoute.keycloak.tokenEndpointHint')}
          />
          <Group justify="flex-end">
            <Button onClick={onClose}>{t('form.btn.close')}</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};
