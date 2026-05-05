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

import { atom } from 'jotai';

import type { User } from '@/apis/auth';
import type { UserInstanceRole } from '@/apis/instances';

// User-Instance assignments
export const userInstancesAtom = atom<UserInstanceRole[]>([]);

// --- Token atoms with proper reactivity ---
// These use internal Jotai state AND sync to localStorage,
// so that writes trigger re-renders of dependent atoms.

// Internal state atoms (initialized from localStorage)
const _accessTokenAtom = atom(localStorage.getItem('auth:access_token') || '');
const _refreshTokenAtom = atom(localStorage.getItem('auth:refresh_token') || '');
const _tokenExpiryAtom = atom<number>(
  (() => {
    const stored = localStorage.getItem('auth:token_expiry');
    return stored ? parseInt(stored, 10) : 0;
  })()
);

// Public read/write atoms that sync to localStorage
export const accessTokenAtom = atom(
  (get) => get(_accessTokenAtom),
  (_get, set, newValue: string) => {
    set(_accessTokenAtom, newValue);
    if (newValue) {
      localStorage.setItem('auth:access_token', newValue);
    } else {
      localStorage.removeItem('auth:access_token');
    }
  }
);

export const refreshTokenAtom = atom(
  (get) => get(_refreshTokenAtom),
  (_get, set, newValue: string) => {
    set(_refreshTokenAtom, newValue);
    if (newValue) {
      localStorage.setItem('auth:refresh_token', newValue);
    } else {
      localStorage.removeItem('auth:refresh_token');
    }
  }
);

export const tokenExpiryAtom = atom<number, [number], void>(
  (get) => get(_tokenExpiryAtom),
  (_get, set, newValue: number) => {
    set(_tokenExpiryAtom, newValue);
    if (newValue) {
      localStorage.setItem('auth:token_expiry', String(newValue));
    } else {
      localStorage.removeItem('auth:token_expiry');
    }
  }
);

// Internal user atom for reactivity
const _storedUser: User | null = (() => {
  const stored = localStorage.getItem('auth:user');
  try {
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
})();
const _currentUserAtom = atom<User | null>(_storedUser);

// User atom with persistence
export const currentUserAtom = atom<User | null, [User | null], void>(
  (get) => get(_currentUserAtom),
  (_get, set, newValue: User | null) => {
    set(_currentUserAtom, newValue);
    if (newValue) {
      localStorage.setItem('auth:user', JSON.stringify(newValue));
    } else {
      localStorage.removeItem('auth:user');
    }
  }
);

// Loading state
export const authLoadingAtom = atom<boolean>(false);

// Derived atom to check if user is authenticated
export const isAuthenticatedAtom = atom((get) => {
  const accessToken = get(accessTokenAtom);
  const expiry = get(tokenExpiryAtom);
  return !!accessToken && (expiry === 0 || expiry > Date.now());
});

// Auth actions
export const authActionsAtom = atom(
  null,
  (_get, set, action: { type: 'login'; payload: { accessToken: string; refreshToken: string; expiresIn: number } }) => {
    const { accessToken, refreshToken, expiresIn } = action.payload;
    set(accessTokenAtom, accessToken);
    set(refreshTokenAtom, refreshToken);
    set(tokenExpiryAtom, Date.now() + expiresIn * 1000);
  }
);

export const logoutActionAtom = atom(null, (_get, set) => {
  set(accessTokenAtom, '');
  set(refreshTokenAtom, '');
  set(tokenExpiryAtom, 0);
  set(currentUserAtom, null);
  localStorage.removeItem('auth:access_token');
  localStorage.removeItem('auth:refresh_token');
  localStorage.removeItem('auth:token_expiry');
});
