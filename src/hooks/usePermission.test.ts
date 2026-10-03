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
import { getDefaultStore } from 'jotai';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserInstanceRole } from '@/apis/instances';

type PermissionModule = typeof import('./usePermission');
type TeamModule = typeof import('@/stores/team');
type InstanceModule = typeof import('@/stores/instance');
type AuthModule = typeof import('@/stores/auth');

// The stores touch localStorage as their modules load, and this suite runs in
// node: a Map stands in for it, installed before they are imported.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, String(value));
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  },
});

let permissionsAtom: PermissionModule['permissionsAtom'];
let clearTeamPicks: TeamModule['clearTeamPicks'];
let currentTeamIdAtom: TeamModule['currentTeamIdAtom'];
let currentInstanceIdAtom: InstanceModule['currentInstanceIdAtom'];
let currentUserAtom: AuthModule['currentUserAtom'];
let userInstancesAtom: AuthModule['userInstancesAtom'];

beforeAll(async () => {
  ({ permissionsAtom } = await import('./usePermission'));
  ({ clearTeamPicks, currentTeamIdAtom } = await import('@/stores/team'));
  ({ currentInstanceIdAtom } = await import('@/stores/instance'));
  ({ currentUserAtom, userInstancesAtom } = await import('@/stores/auth'));
});

const store = getDefaultStore();
const INSTANCE = 'inst-1';
const mixed: UserInstanceRole = {
  user_id: 'u',
  instance_id: INSTANCE,
  team_id: 'a',
  team_ids: ['a', 'b'],
  team_roles: { a: 'viewer', b: 'developer' },
  role: 'developer',
  teams: [
    { id: 'a', name: 'A', role: 'viewer' },
    { id: 'b', name: 'B', role: 'developer' },
  ],
};

const signIn = (assignment: UserInstanceRole) => {
  store.set(currentUserAtom, { id: 'u', username: 'u', email: '', role: '', created_at: null });
  store.set(userInstancesAtom, [assignment]);
  store.set(currentInstanceIdAtom, INSTANCE);
};

describe('a role per team', () => {
  beforeEach(() => {
    storage.clear();
    clearTeamPicks();
  });

  it('writes the teams it develops in, and only those', () => {
    signIn(mixed);
    const p = store.get(permissionsAtom);
    expect(p.canWriteOwner('b')).toBe(true);
    expect(p.canWriteOwner('a')).toBe(false);
    expect(p.canWriteOwner(undefined)).toBe(false);
    expect(p.canWriteOwner('x')).toBe(false);
  });

  it('offers no create with a viewer team picked, and one with a developer team or none', () => {
    signIn(mixed);
    expect(store.get(permissionsAtom).canCreate).toBe(true);
    store.set(currentTeamIdAtom, 'a');
    expect(store.get(permissionsAtom).canCreate).toBe(false);
    store.set(currentTeamIdAtom, 'b');
    expect(store.get(permissionsAtom).canCreate).toBe(true);
  });

  it('reads an assignment from before the roles as its role in every team', () => {
    signIn({
      ...mixed,
      team_roles: undefined,
      teams: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    expect(store.get(permissionsAtom).canWriteOwner('a')).toBe(true);
  });

  it('is a viewer in every team: no write, no create', () => {
    signIn({ ...mixed, role: 'viewer', team_roles: { a: 'viewer', b: 'viewer' } });
    const p = store.get(permissionsAtom);
    expect(p.isViewer).toBe(true);
    expect(p.canCreate).toBe(false);
    expect(p.canWriteOwner('b')).toBe(false);
  });

  it('lets an admin write any team', () => {
    signIn({ ...mixed, role: 'instance_admin', team_roles: undefined });
    expect(store.get(permissionsAtom).canWriteOwner('a')).toBe(true);
  });
});
