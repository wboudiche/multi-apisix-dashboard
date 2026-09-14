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

const storedTeam = (instanceId: string) =>
  storage.get(`team:current_id:${instanceId}`) || '';

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
      storage.set(`team:current_id:${instanceId}`, newValue);
    } else {
      storage.remove(`team:current_id:${instanceId}`);
    }
  }
);

/**
 * The team this tab sends for `instanceId`, for the request interceptors.
 *
 * For the selected instance, exactly the team the header shows. For another
 * one — a request can name its instance — this tab's pick for it, or the
 * stored team before it has made one. Read from localStorage alone, it was
 * whichever team the last tab to pick had put there: for an admin, the owner
 * of every resource this tab created (#195).
 */
export const selectedTeamId = (instanceId: string): string => {
  if (!instanceId) return '';
  const store = getDefaultStore();
  if (instanceId === store.get(currentInstanceIdAtom)) {
    return store.get(currentTeamIdAtom);
  }
  const picked = store.get(_pickedTeamAtom);
  return instanceId in picked ? picked[instanceId] : storedTeam(instanceId);
};

// Simple string atom for the current team name, set by the header component
export const currentTeamNameAtom = atom<string>('');
