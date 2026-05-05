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
import { Badge, Code, Group, Paper, Text } from '@mantine/core';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { METHOD_COLORS } from './util';

export const MatchPreview = () => {
  const { t } = useTranslation();
  const [methods = [], uri = '', uris = [], host = ''] = useWatch({
    name: ['methods', 'uri', 'uris', 'host'],
  });

  const displayUri = uri || (uris.length > 0 ? uris.join(', ') : '');

  if (!displayUri && methods.length === 0) return null;

  return (
    <Paper
      p="xs"
      radius="md"
      mb="md"
      style={{
        border: '1px dashed var(--brand)',
        background: 'color-mix(in srgb, var(--brand) 5%, transparent)',
      }}
    >
      <Group gap="xs" wrap="wrap" align="center">
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.05em' }}>
          {t('form.routes.preview.matchPreviewLabel')}
        </Text>
        {methods.length > 0 ? (
          methods.map((m: string) => (
            <Badge key={m} color={METHOD_COLORS[m] || 'gray'} variant="filled" size="sm">
              {m}
            </Badge>
          ))
        ) : (
          <Badge color="gray" variant="light" size="sm">{t('form.routes.preview.allMethods')}</Badge>
        )}
        {displayUri && (
          <Code style={{ fontSize: '0.85rem' }}>{displayUri}</Code>
        )}
        {host && (
          <>
            <Text size="xs" c="dimmed">@</Text>
            <Text size="sm" fw={500}>{host}</Text>
          </>
        )}
      </Group>
    </Paper>
  );
};
