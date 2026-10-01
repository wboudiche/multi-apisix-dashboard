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
import type { InternalAxiosRequestConfig } from 'axios';
import { getDefaultStore } from 'jotai';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TeamModule = typeof import('./team');
type InstanceModule = typeof import('./instance');
type AuthModule = typeof import('./auth');
type ReqModule = typeof import('@/config/req');
type ClientModule = typeof import('@/apis/client');

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

let currentTeamIdAtom: TeamModule['currentTeamIdAtom'];
let ownTeamsAtom: TeamModule['ownTeamsAtom'];
let sentTeamIdAtom: TeamModule['sentTeamIdAtom'];
let clearTeamPicks: TeamModule['clearTeamPicks'];
let currentInstanceIdAtom: InstanceModule['currentInstanceIdAtom'];
let currentUserAtom: AuthModule['currentUserAtom'];
let req: ReqModule['req'];
let reqFor: ReqModule['reqFor'];
let apiClient: ClientModule['apiClient'];
const sent: InternalAxiosRequestConfig[] = [];

const answer = async (config: InternalAxiosRequestConfig) => {
  sent.push(config);
  return {
    data: { list: [], total: 0 },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
};

beforeAll(async () => {
  ({ currentTeamIdAtom, ownTeamsAtom, sentTeamIdAtom, clearTeamPicks } = await import('./team'));
  ({ currentInstanceIdAtom } = await import('./instance'));
  ({ currentUserAtom } = await import('./auth'));
  ({ req, reqFor } = await import('@/config/req'));
  ({ apiClient } = await import('@/apis/client'));
  req.defaults.adapter = answer;
  apiClient.defaults.adapter = answer;
});

const store = () => getDefaultStore();
const lastTeam = () => sent[sent.length - 1]?.headers.get('X-Team-ID');

// The atoms are this tab's own; localStorage is every tab's, and nothing
// listens for another tab writing it.
const anotherTabPicks = (instance: string, team: string) =>
  storage.set(`team:current_id:${instance}`, team);

// Only a super admin gets the teams list, and so a team switcher: the tests
// that pick teams are about one.
const account = (role: string) => ({
  id: `user-${role || 'none'}`,
  username: role || 'instance-admin',
  email: '',
  role,
  created_at: '',
});

let n = 0;
beforeEach(() => {
  storage.clear();
  sent.length = 0;
  store().set(currentUserAtom, account('super_admin'));
  store().set(ownTeamsAtom, {});
  // A fresh instance id per test: the team atom keeps what it read for an
  // instance, so reusing one would carry a test's choice into the next.
  n += 1;
  store().set(currentInstanceIdAtom, `inst-${n}`);
});
const here = () => `inst-${n}`;

describe('the team this tab works with', () => {
  it('is the one just picked, as soon as it is picked', () => {
    // The header's team selector shows this atom.
    expect(store().get(currentTeamIdAtom)).toBe('');
    store().set(currentTeamIdAtom, 'T1');
    expect(store().get(currentTeamIdAtom)).toBe('T1');
  });

  it('is what APISIX requests send, whatever another tab has picked', async () => {
    // For an admin, X-Team-ID is the team a created resource is assigned to.
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(here(), 'T2');

    await req.get('/routes');
    expect(lastTeam()).toBe('T1');
  });

  it('is what the dashboard’s own requests send, whatever another tab has picked', async () => {
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(here(), 'T2');

    await apiClient.get('/api/v1/labels');
    expect(lastTeam()).toBe('T1');
  });

  it('is "All Teams" once picked, not another tab’s team', async () => {
    store().set(currentTeamIdAtom, 'T1');
    store().set(currentTeamIdAtom, '');
    anotherTabPicks(here(), 'T2');

    expect(store().get(currentTeamIdAtom)).toBe('');
    await req.get('/routes');
    expect(sent).toHaveLength(1);
    expect(lastTeam()).toBeUndefined();
  });

  it('is still this tab’s pick after a switch to another instance and back', () => {
    const other = `${here()}-other`;
    store().set(currentTeamIdAtom, 'T1');
    store().set(currentInstanceIdAtom, other);
    anotherTabPicks(here(), 'T2');
    store().set(currentInstanceIdAtom, here());

    expect(store().get(currentTeamIdAtom)).toBe('T1');
  });

  it('is the stored one before this tab has picked any', async () => {
    anotherTabPicks(here(), 'T2');

    await req.get('/routes');
    expect(lastTeam()).toBe('T2');
  });

  it('is none for an account without a team switcher, whatever was picked', async () => {
    // An instance admin is an admin to the proxy — its X-Team-ID becomes the
    // owner of what it creates or edits — but it gets no teams list and so no
    // switcher: a team sent for it is one it cannot see (#203).
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(here(), 'T2');
    store().set(currentUserAtom, account(''));

    await req.get('/routes');
    await apiClient.get('/api/v1/labels');
    expect(sent).toHaveLength(2);
    expect(sent.map((c) => c.headers.get('X-Team-ID'))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('is none, on any instance, once a new session starts', () => {
    // A pick belongs to the account that made it. Signing out from the menu
    // and in as someone else happens in one tab, without a reload (#203).
    const other = `${here()}-other`;
    // Mounted, as the header's switcher mounts it: a mounted atom recomputes
    // the moment the picks change, and reads whatever is still stored then.
    const unsubscribe = store().sub(currentTeamIdAtom, () => {});
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(other, 'T9');

    clearTeamPicks();
    unsubscribe();

    expect(store().get(currentTeamIdAtom)).toBe('');
    expect(storage.has(`team:current_id:${here()}`)).toBe(false);
    expect(storage.has(`team:current_id:${other}`)).toBe(false);
  });

  it('is this tab’s choice for an instance a request names', async () => {
    const other = `${here()}-other`;
    store().set(currentInstanceIdAtom, other);
    store().set(currentTeamIdAtom, 'T-other');
    store().set(currentInstanceIdAtom, here());
    anotherTabPicks(other, 'T2');

    await reqFor(other).get('/routes');
    expect(lastTeam()).toBe('T-other');
  });
});

// A developer or a viewer can work for several teams on one instance (#301).
// The backend reads their X-Team-ID as which of those teams a request is for,
// and refuses one that is not theirs on every proxied request - so what this
// tab sends for them is one of the teams the header offers them, or nothing.
describe('the team a developer with several sends', () => {
  const team = (id: string) => ({ id, name: `team ${id}` });
  // What the header stores from /user for the account on an instance: every
  // id of the assignment, and the teams among them that still exist.
  const own = (instance: string, ids: string[], live: string[] = ids) => {
    store().set(currentUserAtom, account(''));
    store().set(ownTeamsAtom, {
      ...store().get(ownTeamsAtom),
      [instance]: { ids, teams: live.map(team) },
    });
  };

  it('is the one of their teams they picked', async () => {
    own(here(), ['T1', 'T2']);
    store().set(currentTeamIdAtom, 'T2');

    await req.get('/routes');
    await apiClient.get('/api/v1/labels');
    expect(sent.map((c) => c.headers.get('X-Team-ID'))).toEqual(['T2', 'T2']);
    // And what the switcher shows as picked.
    expect(store().get(sentTeamIdAtom)).toBe('T2');
  });

  it('is none until they pick: every team of theirs', async () => {
    own(here(), ['T1', 'T2']);

    await req.get('/routes');
    expect(lastTeam()).toBeUndefined();
  });

  it('is none for a pick that is not one of their teams', async () => {
    // A team left in storage by another tab, or one they were taken off since:
    // sent, it would have every request refused, and nothing on screen to say
    // which team was asked for.
    own(here(), ['T1', 'T2']);
    anotherTabPicks(here(), 'T9');

    await req.get('/routes');
    expect(lastTeam()).toBeUndefined();
    expect(store().get(sentTeamIdAtom)).toBe('');
  });

  it('is none for a pick whose team was deleted, though the assignment still names it', async () => {
    // The switcher offers the teams that exist. Checked against the
    // assignment instead, this pick was shown as "all my teams" and sent all
    // the same: every list empty, and a create recorded for a team that is
    // gone.
    own(here(), ['T1', 'T2', 'T3'], ['T1', 'T2']);
    store().set(currentTeamIdAtom, 'T3');

    await req.get('/routes');
    expect(lastTeam()).toBeUndefined();
  });

  it('is none with one team: there is nothing to say', async () => {
    own(here(), ['T1']);
    store().set(currentTeamIdAtom, 'T1');

    await req.get('/routes');
    expect(lastTeam()).toBeUndefined();
  });

  it('is the one team left when the assignment still names a deleted one', async () => {
    // To the backend this account has two teams, and a create has to say
    // which; the header has one to show and nothing to choose (#375).
    own(here(), ['T1', 'T2'], ['T2']);

    await req.get('/routes');
    expect(lastTeam()).toBe('T2');
  });

  it('is none before the header has read their teams, and the pick once it has', async () => {
    // A reload: the pick is in storage at once, the teams arrive with the
    // header. Nothing is sent on trust in between.
    store().set(currentUserAtom, account(''));
    anotherTabPicks(here(), 'T2');

    await req.get('/routes');
    expect(lastTeam()).toBeUndefined();
    expect(store().get(sentTeamIdAtom)).toBe('');

    own(here(), ['T1', 'T2']);
    expect(store().get(sentTeamIdAtom)).toBe('T2');
    await req.get('/routes');
    expect(lastTeam()).toBe('T2');
  });

  it('is none for an account the header stores no teams for', async () => {
    // An instance admin - still #203 - or a session that has just begun.
    store().set(currentUserAtom, account(''));
    store().set(currentTeamIdAtom, 'T1');

    await req.get('/routes');
    expect(lastTeam()).toBeUndefined();
  });

  it('is the pick for the instance a request names, when it is theirs there', async () => {
    const other = `${here()}-other`;
    own(here(), ['T1', 'T2']);
    own(other, ['T3', 'T4']);
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(other, 'T4');

    await reqFor(other).get('/routes');
    expect(lastTeam()).toBe('T4');
    await req.get('/routes');
    expect(lastTeam()).toBe('T1');
  });

  it('forgets the last account’s teams when a session starts', () => {
    own(here(), ['T1', 'T2']);
    clearTeamPicks();
    expect(store().get(ownTeamsAtom)).toEqual({});
  });
});
