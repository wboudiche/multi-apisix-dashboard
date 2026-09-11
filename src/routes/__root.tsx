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

import { endSession, refreshSession, SessionOverError } from '@/apis/session';
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

/**
 * What the stored session is worth right now.
 *
 * `expired` is deliberately not the same answer as `absent`. Access tokens
 * last 15 minutes and refresh tokens 7 days, so a tab left alone over lunch
 * has a lapsed access token and a session that is good for another week — and
 * treating those alike signed the operator out on their next click with the
 * means to renew sitting in the same localStorage (#174).
 */
function sessionState(): 'valid' | 'expired' | 'absent' {
  const token = localStorage.getItem('auth:access_token');
  if (!token) return 'absent';
  const expiryStr = localStorage.getItem('auth:token_expiry');
  if (!expiryStr) return 'valid';
  const expiry = parseInt(expiryStr, 10);
  return expiry === 0 || expiry > Date.now() ? 'valid' : 'expired';
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
  beforeLoad: async ({ location }) => {
    // Allow the login page without authentication
    const isLoginPage = location.pathname === '/login' || location.pathname === '/ui/login';
    if (isLoginPage) return;

    const state = sessionState();

    // Nothing stored at all: not a session that ended, so nothing to explain.
    if (state === 'absent') {
      throw redirect({
        to: '/login',
      });
    }

    if (state === 'expired') {
      // The same rule the request layer follows: only the backend refusing the
      // refresh token ends a session. A dropped connection or a restarting
      // backend means try again, and the requests on the page being navigated
      // to will report it themselves — signing someone out for one would cost
      // them their work to recover from something already fixed.
      //
      // The redirect is thrown after the try, not inside it: redirect() works
      // by throwing, and this catch would swallow it.
      let sessionOver = false;
      try {
        await refreshSession();
      } catch (error) {
        sessionOver = error instanceof SessionOverError;
      }
      if (sessionOver) {
        // endSession rather than clearing and redirecting through the router.
        // It reloads the page, and that is load-bearing: the query cache, the
        // atoms and every in-flight request in this tab were built on the
        // session that just ended. A client-side redirect leaves them, and
        // `ensureQueryData` in the loaders returns cached data without
        // revalidating — so the next person to sign in sees the last one's
        // lists until the refetch lands.
        endSession();
        throw redirect({
          to: '/login',
        });
      }
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
