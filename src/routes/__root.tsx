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
import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { createRootRoute, HeadContent, Outlet, redirect, useLocation } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';

import { Header } from '@/components/Header';
import { Navbar } from '@/components/Navbar';
import { InstanceGuard } from '@/components/page/InstanceGuard';
import { PageError } from '@/components/page/PageError';
import { PageLoader } from '@/components/page/PageLoader';
import { ProxyErrorBanner } from '@/components/page/ProxyErrorBanner';
import {
  APPSHELL_HEADER_HEIGHT,
  APPSHELL_NAVBAR_WIDTH,
} from '@/config/constant';
import i18n from '@/config/i18n';
import { isAuthenticatedAtom } from '@/stores/auth';

/** Check if the user has a valid token in localStorage */
function isAuthenticated(): boolean {
  const token = localStorage.getItem('auth:access_token');
  if (!token) return false;
  const expiryStr = localStorage.getItem('auth:token_expiry');
  if (!expiryStr) return !!token;
  const expiry = parseInt(expiryStr, 10);
  return expiry === 0 || expiry > Date.now();
}

/** Check if the stored user still has to change their password */
function mustChangePassword(): boolean {
  const stored = localStorage.getItem('auth:user');
  if (!stored) return false;
  try {
    const user = JSON.parse(stored) as { must_change_password?: boolean };
    return user.must_change_password === true;
  } catch {
    return false;
  }
}

const Root = () => {
  const [opened, { toggle }] = useDisclosure(false);
  const [collapsed, setCollapsed] = useState(false);
  const authenticated = useAtomValue(isAuthenticatedAtom);
  const location = useLocation();

  // Check if on login page (both /login and /ui/login)
  const isLoginPage = location.pathname === '/login' || location.pathname === '/ui/login';
  const isChangePasswordPage =
    location.pathname === '/change-password' || location.pathname === '/ui/change-password';

  // Show AppShell only when authenticated AND not on a bare full-screen page
  const showAppShell = authenticated && !isLoginPage && !isChangePasswordPage;

  // Pages that operate against an APISIX instance and therefore need a
  // selected instance to make sense. Multi-tenant management pages and the
  // landing pages don't — overview aggregates across instances, instances/
  // teams/users are admin CRUD that lives entirely in the dashboard's etcd.
  const path = location.pathname.replace(/^\/ui/, '');
  const requiresInstance = !['/', '', '/login', '/overview', '/instances', '/teams', '/users']
    .includes(path)
    && !path.startsWith('/instances/')
    && !path.startsWith('/teams/')
    && !path.startsWith('/users/');

  return (
    <I18nextProvider i18n={i18n}>
      <HeadContent />
      {showAppShell ? (
        <AppShell
          header={{ height: APPSHELL_HEADER_HEIGHT }}
          navbar={{
            width: collapsed ? 80 : APPSHELL_NAVBAR_WIDTH,
            breakpoint: 'sm',
            collapsed: { mobile: !opened },
          }}
          padding="xs"
          transitionDuration={300}
          transitionTimingFunction="ease"
        >
          <Header
            opened={opened}
            toggle={toggle}
            collapsed={collapsed}
            onCollapseToggle={() => setCollapsed(!collapsed)}
          />

          <Navbar collapsed={collapsed} onCollapseToggle={() => setCollapsed(!collapsed)} />

          <AppShell.Main style={{ paddingLeft: 'calc(var(--app-shell-navbar-offset, 0px) + 40px)', paddingRight: '40px' }}>
            <ProxyErrorBanner />
            {requiresInstance ? (
              <InstanceGuard>
                <Outlet />
              </InstanceGuard>
            ) : (
              <Outlet />
            )}
          </AppShell.Main>
        </AppShell>
      ) : (
        // For unauthenticated users or login page, just render the outlet
        <Outlet />
      )}
    </I18nextProvider>
  );
};

export const Route = createRootRoute({
  component: Root,
  beforeLoad: ({ location }) => {
    // Allow the login page without authentication
    const isLoginPage = location.pathname === '/login' || location.pathname === '/ui/login';
    if (isLoginPage) return;

    // Redirect to login if not authenticated
    if (!isAuthenticated()) {
      throw redirect({
        to: '/login',
      });
    }

    // A pending forced password change locks the app down to the dedicated
    // screen; the backend enforces the same rule with 403s.
    const isChangePasswordPage =
      location.pathname === '/change-password' || location.pathname === '/ui/change-password';
    if (!isChangePasswordPage && mustChangePassword()) {
      throw redirect({
        to: '/change-password',
      });
    }
  },
  pendingComponent: () => <PageLoader message={i18n.t('dashboard.loading')} />,
  errorComponent: ({ error }) => (
    <PageError
      error={error}
      title={i18n.t('dashboard.errorTitle')}
      message={i18n.t('dashboard.errorMessage')}
    />
  ),
});
