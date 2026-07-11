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

import { notifications } from '@mantine/notifications';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { useSetAtom } from 'jotai';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { authApi } from '@/apis/auth';
import apisixLogo from '@/assets/apisix-logo.svg';
import {
  accessTokenAtom,
  currentUserAtom,
  refreshTokenAtom,
  tokenExpiryAtom,
} from '@/stores/auth';

import classes from './style.module.css';

const EyeOpenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 3.9M6.1 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3-.5" />
  </svg>
);

const BrandPanel = () => {
  const { t } = useTranslation();
  return (
    <aside className={classes.brand}>
      <div className={classes.wordmark}>
        <span className={classes.tile}>
          <img src={apisixLogo} alt={t('apisix.logo')} />
        </span>
        <span className={classes.name}>
          <b>{t('login.brandName')}</b>
          <span>{t('login.brandKicker')}</span>
        </span>
      </div>

      <div className={classes.status}>{t('login.brandPill')}</div>

      <h1>{t('login.tagline')}</h1>
      <p className={classes.sub}>{t('login.taglineSub')}</p>

      <ul className={classes.features}>
        <li>
          <span className={classes.featIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="7" rx="2" />
              <rect x="3" y="14" width="18" height="7" rx="2" />
              <path d="M7 7.5h.01M7 17.5h.01" />
            </svg>
          </span>
          <div>
            <b>{t('login.featInstancesTitle')}</b>
            <p>{t('login.featInstancesDesc')}</p>
          </div>
        </li>
        <li>
          <span className={classes.featIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3Z" />
              <path d="M9.2 12l2 2 3.6-4" />
            </svg>
          </span>
          <div>
            <b>{t('login.featRolesTitle')}</b>
            <p>
              <Trans i18nKey="login.featRolesDesc" components={{ chip: <code /> }} />
            </p>
          </div>
        </li>
        <li>
          <span className={classes.featIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="8.5" r="3.2" />
              <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
              <circle cx="17" cy="9.5" r="2.4" />
              <path d="M15.5 14.6a4.6 4.6 0 0 1 5 4.4" />
            </svg>
          </span>
          <div>
            <b>{t('login.featTeamsTitle')}</b>
            <p>{t('login.featTeamsDesc')}</p>
          </div>
        </li>
      </ul>

      <p className={classes.foot}>{t('login.builtOn')}</p>
    </aside>
  );
};

const Login = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const setAccessToken = useSetAtom(accessTokenAtom);
  const setRefreshToken = useSetAtom(refreshTokenAtom);
  const setTokenExpiry = useSetAtom(tokenExpiryAtom);
  const setCurrentUser = useSetAtom(currentUserAtom);

  const checkCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState('CapsLock'));
  };

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
    <div className={classes.stage}>
      <BrandPanel />

      <div className={classes.formCol}>
        <div className={classes.container}>
          <div className={classes.head}>
            <h1>{t('login.welcomeBack')}</h1>
            <p>{t('login.adminNote')}</p>
          </div>
          <form className={classes.form} onSubmit={handleLogin}>
            <div className={classes.field}>
              <label htmlFor="login-username">{t('login.username')}</label>
              <div className={classes.row}>
                <input
                  id="login-username"
                  className={classes.input}
                  type="text"
                  placeholder={t('login.usernamePlaceholder')}
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div className={classes.field}>
              <label htmlFor="login-password">{t('login.password')}</label>
              <div className={classes.row}>
                <input
                  id="login-password"
                  className={`${classes.input} ${classes.pw}`}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={checkCapsLock}
                  onKeyUp={checkCapsLock}
                  onBlur={() => setCapsLock(false)}
                />
                <button
                  type="button"
                  className={classes.eye}
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeOpenIcon />}
                </button>
              </div>
              {capsLock && (
                <div className={classes.capslock}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 4 4 12h5v5h6v-5h5L12 4Z" />
                  </svg>
                  {t('login.capsLock')}
                </div>
              )}
            </div>
            <div className={classes.aids}>
              <button
                type="button"
                className={classes.forgot}
                aria-expanded={forgotOpen}
                onClick={() => setForgotOpen((v) => !v)}
              >
                {t('login.forgot')}
              </button>
            </div>
            {forgotOpen && <p className={classes.forgotHint}>{t('login.forgotHint')}</p>}
            {error && (
              <div className={classes.error} role="alert">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v6M12 16h.01" />
                </svg>
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className={classes.submit} disabled={loading}>
              {loading && <span className={classes.spinner} />}
              {t('login.signIn')}
            </button>
          </form>
          <p className={classes.legal}>{t('login.license')}</p>
        </div>
      </div>
    </div>
  );
};

export const Route = createFileRoute('/login/')({
  component: Login,
});
