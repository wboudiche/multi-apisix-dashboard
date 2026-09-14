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

import { atom, getDefaultStore } from 'jotai';

import { currentUserAtom } from '@/stores/auth';
import { currentInstanceIdAtom } from '@/stores/instance';

// Custom storage helper to avoid JSON.stringify adding quotes to strings
const storage = {
  get: (key: string): string | null => {
    return localStorage.getItem(key);
  },
  set: (key: string, value: string): void => {
    localStorage.setItem(key, value);
  },
  remove: (key: string): void => {
    localStorage.removeItem(key);
  },
};

const TEAM_KEY = 'team:current_id:';

const storedTeam = (instanceId: string) =>
  storage.get(`${TEAM_KEY}${instanceId}`) || '';

// The team this tab has picked, per instance, once it has picked one.
// localStorage keeps the last pick any tab made — a new tab starts from it —
// but it is every tab's, and nothing listens for another tab writing it.
const _pickedTeamAtom = atom<Record<string, string>>({});

// Jotai atom for current team ID, scoped per instance
// localStorage key: team:current_id:{instanceId}
// "" means "All Teams" (no filtering)
//
// This tab's pick for the instance, or the stored team before it has made one.
// The pick is state the atom depends on: the setter used to write localStorage
// alone, which changed nothing the atom depended on, so the header's switcher
// went on showing the previous team after a pick (#195).
export const currentTeamIdAtom = atom(
  (get) => {
    const instanceId = get(currentInstanceIdAtom);
    if (!instanceId) return '';
    const picked = get(_pickedTeamAtom);
    return instanceId in picked ? picked[instanceId] : storedTeam(instanceId);
  },
  (get, set, newValue: string) => {
    const instanceId = get(currentInstanceIdAtom);
    if (!instanceId) return;
    set(_pickedTeamAtom, { ...get(_pickedTeamAtom), [instanceId]: newValue });
    if (newValue) {
      storage.set(`${TEAM_KEY}${instanceId}`, newValue);
    } else {
      storage.remove(`${TEAM_KEY}${instanceId}`);
    }
  }
);

/**
 * The team this tab sends for `instanceId`, for the request interceptors.
 *
 * None unless the account is a super admin. The proxy records an admin's team
 * as the owner of whatever it creates or edits, but only a super admin gets
 * the teams list, and so a switcher to see and change the team: an instance
 * admin, an admin to the proxy too, sent a team it could not see (#203). For
 * the other roles the backend takes the team from the account's assignment
 * and ignores the header.
 *
 * For the selected instance, exactly the team the header shows. For another
 * one — a request can name its instance — this tab's pick for it, or the
 * stored team before it has made one. Read from localStorage alone, it was
 * whichever team the last tab to pick had put there (#195).
 */
export const selectedTeamId = (instanceId: string): string => {
  const store = getDefaultStore();
  if (!instanceId || store.get(currentUserAtom)?.role !== 'super_admin') {
    return '';
  }
  if (instanceId === store.get(currentInstanceIdAtom)) {
    return store.get(currentTeamIdAtom);
  }
  const picked = store.get(_pickedTeamAtom);
  return instanceId in picked ? picked[instanceId] : storedTeam(instanceId);
};

/**
 * Forget every team pick — this tab's, and the ones stored for new tabs.
 *
 * Called when a session starts. A pick belongs to the account that made it,
 * and signing out from the header menu and in as someone else happens in one
 * tab, without a reload: the next account started from the last one's team
 * (#203). Done at the start of a session rather than the end, so no way of
 * ending one — the menu, an expiry, a closed tab — can leave a pick behind.
 */
export const clearTeamPicks = () => {
  getDefaultStore().set(_pickedTeamAtom, {});
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(TEAM_KEY)) storage.remove(key);
  }
};

// Simple string atom for the current team name, set by the header component
export const currentTeamNameAtom = atom<string>('');
