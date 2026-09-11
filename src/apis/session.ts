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
import axios from 'axios';
import { getDefaultStore } from 'jotai';

import { authActionsAtom, logoutActionAtom } from '@/stores/auth';
import { appUrl } from '@/utils/app-url';

import { authApi } from './auth';

/**
 * The one session, and the one way to renew it.
 *
 * There are two axios instances that carry it — `apiClient` for the dashboard's
 * own endpoints, `req` for everything proxied to a gateway — and only the first
 * knew how to refresh. So an access token lapsing while someone was on a
 * resource page could not be renewed by the call that discovered it (#168).
 */

/**
 * The code the backend stamps on a 401 it raised about this session.
 *
 * The proxy relays APISIX's status verbatim (handlers/proxy.go), so a 401 can
 * equally mean the instance's admin key is wrong. Those want opposite
 * responses — sign in again, versus go fix the instance — so only the marked
 * ones end a session. Kept in step with SessionInvalidCode in
 * api/internal/middleware/auth.go.
 */
export const SESSION_INVALID_CODE = 'session_invalid';

/** Whether a 401 body is the dashboard saying this session is over. */
export const isSessionInvalid = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  (body as { code?: unknown }).code === SESSION_INVALID_CODE;

const REFRESH = 'auth:refresh_token';

export const clearStoredSession = () => {
  // Through the store, not localStorage directly. The atoms in stores/auth.ts
  // are initialised from localStorage once, at module evaluation, and nothing
  // re-reads it — so clearing the keys behind their backs leaves every
  // component still rendering from a session that is gone. logoutActionAtom
  // clears the atoms and the keys together, `auth:user` included, and is what
  // the Logout menu item already uses.
  getDefaultStore().set(logoutActionAtom);
};

/** Where the login page looks for why it is being shown. */
export const SIGNED_OUT_REASON_KEY = 'auth:signed_out_reason';

/**
 * Leave the login page something to say.
 *
 * Ending a session is a full page load, which destroys any notification still
 * on screen, so without this the operator arrives at a form with no idea why —
 * halfway through a batch delete, say, with four of twelve routes gone and
 * nothing to explain the rest. sessionStorage rather than a query parameter:
 * it is this tab's business and does not belong in a URL anyone might share.
 *
 * Separate from endSession because the router guard ends a session too, and it
 * redirects through the router rather than by reloading the page.
 */
export const noteSignedOut = (reason = 'session_ended') => {
  try {
    sessionStorage.setItem(SIGNED_OUT_REASON_KEY, reason);
  } catch {
    // Private mode, or storage disabled. Losing the explanation must not lose
    // the redirect.
  }
};

/**
 * Drop the session and go to the login form.
 *
 * A full page load rather than a router navigation: what is being reacted to
 * is a session that no longer exists, and every query cache, atom and
 * in-flight request in the tab was built on it.
 */
export const endSession = (reason = 'session_ended') => {
  clearStoredSession();
  noteSignedOut(reason);
  window.location.href = appUrl('/login');
};

/**
 * The in-flight refresh, if one is running.
 *
 * A single shared promise rather than a flag plus a queue of callbacks. The
 * flag version had an exit that returned without lowering it (#167), after
 * which every later 401 parked on a queue nothing would ever drain. This
 * cannot: the promise is cleared in a `finally` that no return can step over,
 * and concurrent callers await the one refresh instead of being re-notified by
 * hand.
 */
let refreshing: Promise<string> | null = null;

/**
 * The session is over: there is nothing left to renew with, or the backend
 * refused what there was.
 *
 * Distinguished from every other way a refresh can fail — the network dropped,
 * the backend restarted, a proxy answered with the SPA's index.html — because
 * only this one is worth ending a session over. The others say "try again",
 * and signing someone out for one costs them whatever they were in the middle
 * of to recover from something that has already fixed itself.
 */
export class SessionOverError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SessionOverError';
  }
}

const performRefresh = async (): Promise<string> => {
  const refreshToken = localStorage.getItem(REFRESH);
  if (!refreshToken) {
    throw new SessionOverError('no refresh token stored');
  }

  const data = await authApi.refresh(refreshToken).catch((error: unknown) => {
    // Only an answer from the backend saying no. A transport failure, a 500 or
    // a body that was not JSON leaves the session alone.
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 401 || status === 403) {
      throw new SessionOverError(`refresh refused (${status})`);
    }
    throw error;
  });

  // Through the store rather than straight into localStorage. The atoms are
  // initialised from localStorage once and never re-read it, so writing behind
  // them renews the session for every request while isAuthenticatedAtom still
  // reports false — and __root.tsx then renders the page with no Header, no
  // Navbar and no InstanceGuard, on a session that was just renewed.
  getDefaultStore().set(authActionsAtom, {
    type: 'login',
    payload: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    },
  });
  return data.access_token;
};

/** A fresh access token, refreshing at most once however many callers ask. */
export const refreshSession = (): Promise<string> => {
  refreshing ??= performRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
};
