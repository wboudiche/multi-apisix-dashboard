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
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { clsx } from 'clsx';
import { useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authApi } from '@/apis/auth';
import {
  accessTokenAtom,
  currentUserAtom,
  refreshTokenAtom,
  tokenExpiryAtom,
} from '@/stores/auth';

import classes from './style.module.css';

const BrandPanel = () => {
  const { t } = useTranslation();
  return (
    <Box className={classes.brand}>
      <svg
        className={classes.flow}
        viewBox="0 0 900 1000"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="login-halo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
            <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.05" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="login-vignette" cx="0.5" cy="0.47" r="0.8">
            <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
          </radialGradient>
          <pattern
            id="login-dotgrid"
            width="34"
            height="34"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1.2" cy="1.2" r="1.2" fill="#FFFFFF" opacity="0.05" />
          </pattern>
        </defs>
        <rect width="900" height="1000" fill="url(#login-dotgrid)" />
        <ellipse cx="450" cy="460" rx="340" ry="340" fill="url(#login-halo)" />
        <g fill="none" stroke="#FFFFFF">
          <circle cx="450" cy="460" r="150" opacity="0.16" />
          <circle cx="450" cy="460" r="235" opacity="0.09" />
          <circle cx="450" cy="460" r="330" opacity="0.05" />
        </g>
        <path
          d="M450 190 L748 700 H152 Z"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.2"
          opacity="0.07"
        />
        <g className={classes.lines}>
          <path
            className={clsx(classes.a1, classes.thick)}
            d="M-30 90 C 200 170, 330 300, 442 448"
          />
          <path d="M-30 330 C 190 350, 330 400, 440 456" />
          <path className={classes.a2} d="M-30 585 C 210 555, 350 520, 438 470" />
          <path className={classes.thick} d="M-30 800 C 230 730, 360 600, 442 482" />
          <path
            className={clsx(classes.a2, classes.thick)}
            d="M930 60 C 690 150, 560 300, 458 448"
          />
          <path d="M930 320 C 700 350, 570 405, 460 458" />
          <path className={classes.a1} d="M930 600 C 700 565, 565 525, 462 472" />
          <path className={classes.thick} d="M930 850 C 690 750, 560 610, 458 486" />
          <path className={classes.a1} d="M140 1030 C 270 850, 380 660, 446 492" />
          <path d="M760 1030 C 640 860, 530 660, 454 492" />
          <path className={classes.a2} d="M300 -30 C 340 120, 400 300, 446 440" />
          <path d="M620 -30 C 580 130, 500 310, 454 440" />
        </g>
        <g fill="#FFFFFF">
          <circle cx="240" cy="250" r="2.6" opacity="0.4" />
          <circle cx="250" cy="372" r="2" opacity="0.3" />
          <circle cx="262" cy="540" r="2.2" opacity="0.34" />
          <circle cx="292" cy="690" r="2" opacity="0.28" />
          <circle cx="655" cy="242" r="2.6" opacity="0.4" />
          <circle cx="662" cy="382" r="2" opacity="0.3" />
          <circle cx="655" cy="542" r="2.2" opacity="0.34" />
          <circle cx="632" cy="712" r="2" opacity="0.28" />
          <circle cx="356" cy="180" r="1.5" opacity="0.26" />
          <circle cx="540" cy="170" r="1.5" opacity="0.26" />
          <circle cx="352" cy="770" r="1.5" opacity="0.24" />
          <circle cx="556" cy="782" r="1.5" opacity="0.24" />
        </g>
        <rect width="900" height="1000" fill="url(#login-vignette)" />
      </svg>
      <div className={classes.badge}>
        <span>{t('login.badge')}</span>
      </div>
      <div className={classes.markWrap}>
        <svg
          className={classes.mark}
          viewBox="0 0 185 156"
          role="img"
          aria-label={t('apisix.logo')}
        >
          <path d="M0 155.5L94 0L185 155.5H140L94 83L42.5 155.5H0Z" fill="#FFFFFF" />
          <path
            d="M94 82.5L42.5 155H0L76.5 57L94 82.5Z"
            fill="#FFFFFF"
            opacity="0.55"
          />
          <path
            d="M140 155.5H185L94 0L140 155.5Z"
            fill="#FFFFFF"
            opacity="0.78"
          />
        </svg>
      </div>
      <div className={classes.tagline}>
        <h2>{t('login.tagline')}</h2>
        <p>{t('login.taglineSub')}</p>
      </div>
    </Box>
  );
};

const Login = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setAccessToken = useSetAtom(accessTokenAtom);
  const setRefreshToken = useSetAtom(refreshTokenAtom);
  const setTokenExpiry = useSetAtom(tokenExpiryAtom);
  const setCurrentUser = useSetAtom(currentUserAtom);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login({ username, password });

      // Store tokens
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);
      setTokenExpiry(Date.now() + response.expires_in * 1000);

      // Get current user
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);

      notifications.show({
        title: t('login.successTitle'),
        message: t('login.welcome', { username: user.username }),
        color: 'green',
      });

      // Admin-created accounts must set their own password before anything
      // else; the backend rejects every other endpoint until they do.
      if (response.must_change_password) {
        navigate({ to: '/change-password' });
      } else {
        navigate({ to: '/' });
      }
    } catch (err: unknown) {
      const message =
        isAxiosError(err) && err.response?.status === 401
          ? t('login.invalidCredentials')
          : err instanceof Error
            ? err.message
            : t('login.failedTitle');
      setError(message);
      notifications.show({
        title: t('login.failedTitle'),
        message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box className={classes.stage}>
      <Box className={classes.formCol}>
        <Box className={classes.formInner}>
          <Box mb={32}>
            <Title order={1} fz="1.7rem" lts="-0.015em">
              {t('apisix.dashboard')}
            </Title>
            <Text c="dimmed" size="sm" mt={8}>
              {t('login.subtitle')}
            </Text>
          </Box>
          <form onSubmit={handleLogin}>
            <Stack gap="lg">
              <TextInput
                label={t('login.username')}
                placeholder={t('login.usernamePlaceholder')}
                required
                size="md"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <PasswordInput
                label={t('login.password')}
                placeholder={t('login.passwordPlaceholder')}
                required
                size="md"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}

              <Button type="submit" fullWidth loading={loading} size="md">
                {t('login.signIn')}
              </Button>
            </Stack>
          </form>
          <Text size="xs" c="dimmed" className={classes.license}>
            {t('login.license')}
          </Text>
        </Box>
      </Box>
      <BrandPanel />
    </Box>
  );
};

export const Route = createFileRoute('/login/')({
  component: Login,
});
