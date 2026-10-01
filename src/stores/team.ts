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
 * A developer's or a viewer's own teams on an instance, as `/user` answers
 * them in one response: every team id the assignment holds, and the teams
 * among them that still exist, with their names.
 */
export type OwnTeams = {
  ids: string[];
  teams: { id: string; name: string }[];
};

/**
 * Those, per instance, for the signed-in account - filled by the header for a
 * developer or a viewer, and empty for everyone else.
 *
 * The one source for what such an account may choose between: the switcher
 * shows these teams and a request is checked against these teams. Two reads
 * of it, cached apart, offered a team that was then not sent, and sent a
 * deleted team the switcher showed as "all my teams".
 */
export const ownTeamsAtom = atom<Record<string, OwnTeams>>({});

/**
 * The team sent for a developer or a viewer, given their teams on the
 * instance and what they picked.
 *
 * With several teams, the pick when it is one of them, and none otherwise: a
 * pick left in storage by another tab, or a team they were taken off or that
 * was deleted since, would be refused (`team_not_assigned`) on every proxied
 * request. None shows them all of their teams.
 *
 * With one team that exists there is nothing to choose and nothing to say -
 * unless the assignment still names a team that is gone (#375). To the backend
 * that account has several, and a create has to say which: the one that is
 * left is the answer, so it is given.
 */
export const teamToSend = (own: OwnTeams | undefined, pick: string): string => {
  if (!own) return '';
  const live = own.teams.map((team) => team.id);
  if (live.length > 1) return live.includes(pick) ? pick : '';
  if (live.length === 1 && own.ids.length > 1) return live[0];
  return '';
};

/**
 * The team this tab's requests carry for the selected instance. What the
 * header's switcher shows as picked is this, or "all" when it is none.
 *
 * For a super admin, the team it picked: the proxy records an admin's team as
 * the owner of whatever it creates. Only a super admin gets the catalogue,
 * and so a switcher over it: an instance admin, an admin to the proxy too,
 * sent a team it could not see (#203), and sends none - it has no entry in
 * ownTeamsAtom either.
 *
 * For a developer or a viewer (#301), see teamToSend.
 */
export const sentTeamIdAtom = atom((get) => {
  const user = get(currentUserAtom);
  const instanceId = get(currentInstanceIdAtom);
  if (!user || !instanceId) return '';
  const pick = get(currentTeamIdAtom);
  if (user.role === 'super_admin') return pick;
  return teamToSend(get(ownTeamsAtom)[instanceId], pick);
});

/**
 * The team this tab sends for `instanceId`, for the request interceptors.
 *
 * For the selected instance, sentTeamIdAtom: exactly what the header shows.
 * For another one — a request can name its instance — the same rule over this
 * tab's pick for it, or the stored team before it has made one. Read from
 * localStorage alone, it was whichever team the last tab to pick had put
 * there (#195).
 */
export const selectedTeamId = (instanceId: string): string => {
  const store = getDefaultStore();
  const user = store.get(currentUserAtom);
  if (!instanceId || !user) return '';
  if (instanceId === store.get(currentInstanceIdAtom)) return store.get(sentTeamIdAtom);

  const picked = store.get(_pickedTeamAtom);
  const pick = instanceId in picked ? picked[instanceId] : storedTeam(instanceId);
  if (user.role === 'super_admin') return pick;
  return teamToSend(store.get(ownTeamsAtom)[instanceId], pick);
};

/**
 * Forget every team pick — this tab's, and the ones stored for new tabs.
 *
 * Called when a session starts. A pick belongs to the account that made it,
 * and signing out from the header menu and in as someone else happens in one
 * tab, without a reload: the next account started from the last one's team
 * (#203). Done at the start of a session rather than the end, so however
 * this tab's last session ended — the menu, an expiry — it leaves no pick
 * behind here. Another tab left open starts over when the account changes
 * (followOtherTabs, #205), and its own picks go with it.
 */
export const clearTeamPicks = () => {
  // The stored keys first: resetting the picks makes a mounted
  // currentTeamIdAtom recompute at once, reading its fallback from
  // localStorage — and it would keep whatever was still there. Listed before
  // any is removed, since removing one reorders the rest.
  const stored: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(TEAM_KEY)) stored.push(key);
  }
  stored.forEach(storage.remove);
  getDefaultStore().set(_pickedTeamAtom, {});
  // And the teams the last account could choose between: they are not the
  // next one's, whose own arrive with its header.
  getDefaultStore().set(ownTeamsAtom, {});
};
