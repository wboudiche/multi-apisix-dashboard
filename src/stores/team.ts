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

import type { UserInstanceRole } from '@/apis/instances';
import { currentUserAtom, userInstancesAtom } from '@/stores/auth';
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
 * The teams of an assignment: the list, or the one team of an answer from
 * before the list. As `teamsOf` in `@/apis/instances`, which this module
 * cannot import: that one loads the API client, and the client loads this.
 */
const assignedTeams = (assignment: UserInstanceRole | undefined): string[] =>
  assignment?.team_ids ?? (assignment?.team_id ? [assignment.team_id] : []);

/**
 * The teams this account may choose between on `instanceId`: the teams of its
 * assignment there, when there are several and it is a developer or a viewer.
 * Empty otherwise - for one team there is nothing to choose, and an instance
 * admin is not tied to a team.
 */
export const choosableTeamIds = (
  assignments: UserInstanceRole[],
  instanceId: string
): string[] => {
  const assignment = assignments.find((a) => a.instance_id === instanceId);
  if (!assignment || assignment.role === 'instance_admin') return [];
  const teams = assignedTeams(assignment);
  return teams.length > 1 ? teams : [];
};

/**
 * The team this tab sends for `instanceId`, for the request interceptors.
 *
 * For a super admin, the team its switcher shows. The proxy records an
 * admin's team as the owner of whatever it creates, but only a super admin
 * gets the teams list, and so a switcher to see and change the team: an
 * instance admin, an admin to the proxy too, sent a team it could not see
 * (#203), and sends none.
 *
 * For a developer or a viewer with several teams on the instance (#301), the
 * one of them it picked: the backend reads their header as which of their
 * teams a request is for. Never a team that is not in the assignment - a pick
 * left in storage by another tab, or a team they were taken off since - since
 * the backend refuses that (`team_not_assigned`) on every proxied request.
 * With none sent, a list shows all of their teams. With one team there is
 * nothing to say, and nothing is sent.
 *
 * For the selected instance, exactly the team the header shows. For another
 * one — a request can name its instance — this tab's pick for it, or the
 * stored team before it has made one. Read from localStorage alone, it was
 * whichever team the last tab to pick had put there (#195).
 */
export const selectedTeamId = (instanceId: string): string => {
  const store = getDefaultStore();
  const user = store.get(currentUserAtom);
  if (!instanceId || !user) return '';

  const picked = store.get(_pickedTeamAtom);
  const pick =
    instanceId === store.get(currentInstanceIdAtom)
      ? store.get(currentTeamIdAtom)
      : instanceId in picked
        ? picked[instanceId]
        : storedTeam(instanceId);

  if (user.role === 'super_admin') return pick;
  return choosableTeamIds(store.get(userInstancesAtom), instanceId).includes(pick) ? pick : '';
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
};
