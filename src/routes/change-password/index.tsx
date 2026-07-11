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
  Box,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { useAtom, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authApi } from '@/apis/auth';
import { PasswordRequirements } from '@/components/PasswordRequirements';
import { currentUserAtom, logoutActionAtom } from '@/stores/auth';

const ChangePassword = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useAtom(currentUserAtom);
  const logout = useSetAtom(logoutActionAtom);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('changePassword.mismatch'));
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);

      if (currentUser) {
        setCurrentUser({ ...currentUser, must_change_password: false });
      }

      notifications.show({
        title: t('changePassword.success'),
        message: t('changePassword.successMessage'),
        color: 'green',
      });
      navigate({ to: '/' });
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 400) {
        setError(t('changePassword.invalidOld'));
      } else if (isAxiosError(err) && err.response?.status === 422) {
        setError(t('changePassword.policyNotMet'));
      } else {
        setError(err instanceof Error ? err.message : t('changePassword.failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    logout();
    navigate({ to: '/login' });
  };

  return (
    <Center mih="100vh" bg="var(--bg-primary, #f8f9fa)">
      <Box w="100%" maw={440} px="md">
        <Box mb={24}>
          <Title order={1} fz="1.5rem" lts="-0.015em">
            {t('changePassword.title')}
          </Title>
          <Text c="dimmed" size="sm" mt={8}>
            {t('changePassword.subtitle')}
          </Text>
        </Box>
        <Paper withBorder p="xl" radius="lg">
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <PasswordInput
                label={t('changePassword.current')}
                placeholder={t('changePassword.currentPlaceholder')}
                required
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
              <PasswordInput
                label={t('changePassword.new')}
                placeholder={t('changePassword.newPlaceholder')}
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <PasswordRequirements password={newPassword} />
              <PasswordInput
                label={t('changePassword.confirm')}
                placeholder={t('changePassword.confirmPlaceholder')}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              {error && (
                <Text c="red" size="sm" role="alert">
                  {error}
                </Text>
              )}

              <Button type="submit" fullWidth loading={loading}>
                {t('changePassword.submit')}
              </Button>
              <Button variant="subtle" color="gray" onClick={handleSignOut}>
                {t('changePassword.signOut')}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Box>
    </Center>
  );
};

export const Route = createFileRoute('/change-password/')({
  component: ChangePassword,
});
