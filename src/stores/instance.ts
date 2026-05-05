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

import type { Instance } from '@/apis/instances';

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

// Internal state atom for reactivity
const _currentInstanceIdAtom = atom(storage.get('instance:current_id') || '');

// Current selected instance ID - using custom storage to avoid quotes
export const currentInstanceIdAtom = atom(
  (get) => get(_currentInstanceIdAtom),
  (_get, set, newValue: string) => {
    set(_currentInstanceIdAtom, newValue);
    if (newValue) {
      storage.set('instance:current_id', newValue);
    } else {
      storage.remove('instance:current_id');
    }
  }
);

// Instances list
export const instancesAtom = atom<Instance[]>([]);

// Set instances action
export const setInstancesAtom = atom(null, (_get, set, instances: Instance[]) => {
  set(instancesAtom, instances);
});

// Loading state
export const instancesLoadingAtom = atom<boolean>(false);

// Derived atom to get current instance
export const currentInstanceAtom = atom((get) => {
  const instances = get(instancesAtom);
  const currentId = get(currentInstanceIdAtom);
  return instances.find((inst) => inst.id === currentId) || null;
});

// Instance health status (cached)
export const instanceHealthAtom = atom<Record<string, 'connected' | 'disconnected' | 'checking'>>({});
