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
import { Button, Container, Group, NumberInput, Paper, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type PasswordPolicy, policyApi } from '@/apis/policy';
import { usePermission } from '@/hooks/usePermission';

const Settings = () => {
  const { t } = useTranslation();
  const { isSuperAdmin } = usePermission();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['password-policy'], queryFn: policyApi.get });
  const [form, setForm] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: policyApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['password-policy'] });
      notifications.show({ message: t('settings.saved'), color: 'green' });
    },
    onError: (error) => {
      // Surface the server's specific reason (e.g. "min_length must be >= 8")
      // instead of a generic failure message.
      const serverMsg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined;
      notifications.show({ message: serverMsg ?? t('settings.saveError'), color: 'red' });
    },
  });

  if (!isSuperAdmin) {
    return (
      <Container size="sm">
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed">{t('settings.accessDenied')}</Text>
        </Paper>
      </Container>
    );
  }
  if (!form) return null;

  const num = (key: keyof PasswordPolicy, label: string) => (
    <NumberInput
      label={label}
      value={form[key] as number}
      min={0}
      onChange={(v) => setForm({ ...form, [key]: Number(v) || 0 })}
    />
  );
  const sw = (key: keyof PasswordPolicy, label: string) => (
    <Switch
      label={label}
      checked={form[key] as boolean}
      onChange={(e) => setForm({ ...form, [key]: e.currentTarget.checked })}
    />
  );

  return (
    <Container size="sm">
      <Title order={2} mb="lg">{t('settings.passwordPolicy')}</Title>
      <Paper p="xl" withBorder>
        <Stack gap="md">
          {num('min_length', t('settings.minLength'))}
          {num('max_length', t('settings.maxLength'))}
          {sw('require_uppercase', t('settings.requireUppercase'))}
          {sw('require_lowercase', t('settings.requireLowercase'))}
          {sw('require_digit', t('settings.requireDigit'))}
          {sw('require_symbol', t('settings.requireSymbol'))}
          {num('history_depth', t('settings.historyDepth'))}
          {num('expiry_days', t('settings.expiryDays'))}
          {num('lockout_threshold', t('settings.lockoutThreshold'))}
          {num('lockout_window_minutes', t('settings.lockoutWindowMinutes'))}
          <Group justify="flex-end">
            <Button loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
              {t('settings.save')}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
};

export const Route = createFileRoute('/settings/')({
  component: Settings,
});
