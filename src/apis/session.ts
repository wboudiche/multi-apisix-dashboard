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

const ACCESS = 'auth:access_token';
const REFRESH = 'auth:refresh_token';
const EXPIRY = 'auth:token_expiry';
const USER = 'auth:user';

export const clearStoredSession = () => {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
  localStorage.removeItem(EXPIRY);
  // The user record too. It is read back into currentUserAtom on load
  // (stores/auth.ts) and by mustChangePassword in __root.tsx, so leaving it
  // behind means the next visit starts as someone who has no session.
  localStorage.removeItem(USER);
};

/**
 * Drop the session and go to the login form.
 *
 * A full page load rather than a router navigation: what is being reacted to
 * is a session that no longer exists, and every query cache, atom and in-flight
 * request in the tab was built on it.
 */
/** Where the login page looks for why it is being shown. */
export const SIGNED_OUT_REASON_KEY = 'auth:signed_out_reason';

export const endSession = (reason = 'session_ended') => {
  clearStoredSession();
  // Left for the login page to pick up. Ending a session is a full page load,
  // which destroys any notification still on screen, so without this the
  // operator arrives at a form with no idea why — halfway through a batch
  // delete, say, with four of twelve routes gone and nothing to explain the
  // rest. sessionStorage rather than a query parameter: it is this tab's
  // business and does not belong in a URL anyone might share or bookmark.
  try {
    sessionStorage.setItem(SIGNED_OUT_REASON_KEY, reason);
  } catch {
    // Private mode, or storage disabled. The redirect matters more than the
    // explanation; losing the explanation must not lose the redirect.
  }
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
  localStorage.setItem(ACCESS, data.access_token);
  localStorage.setItem(REFRESH, data.refresh_token);
  localStorage.setItem(EXPIRY, String(Date.now() + data.expires_in * 1000));
  return data.access_token;
};

/** A fresh access token, refreshing at most once however many callers ask. */
export const refreshSession = (): Promise<string> => {
  refreshing ??= performRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
};
