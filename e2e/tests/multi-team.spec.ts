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
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  HttpError,
  loginAdmin,
  type Team,
  type UserInstance,
} from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * A user belonged to at most one team per instance, so the only way to let a
 * developer work for two teams on one gateway was to make them an instance
 * admin - every team and every resource type, for the want of a second team
 * (#301).
 *
 * Through the API, as the dashboard calls it: the rules live in the proxy, and
 * this is the only place they are exercised with a gateway behind them.
 */
const PROXY = '/api/v1/apisix/admin';
// Its own for every run: afterAll deletes users and teams by this prefix, and
// a fixed one would delete those of another run against the same backend.
const PREFIX = randomId('e2e-multi-team');
const PASSWORD = 'e2e-Mult1-team!pass';
const fx = () => getFixtures();
const onInstance = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const route = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});

type Row = { value: { id: string; desc?: string; __team_id?: string } };

// Every test reads what beforeAll made, and two of them write to it.
test.describe.configure({ mode: 'serial' });

let mine: Team;
let alsoMine: Team;
let theirs: Team;
let assignment: UserInstance;
const ROUTE_NAME = `${PREFIX}-route`;
const routeOf = { mine: `${ROUTE_NAME}-a`, alsoMine: `${ROUTE_NAME}-b`, theirs: `${ROUTE_NAME}-c` };

const devToken = () => loginAdmin(`${PREFIX}-dev`, PASSWORD);

const refusal = async (request: Promise<unknown>): Promise<HttpError | undefined> => {
  try {
    await request;
    return undefined;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
};

/** The fixture routes a caller's list shows, by id, with the team each names. */
const listed = async (token: string, team?: string) => {
  const res = (await apiFetch(`${PROXY}/routes?name=${ROUTE_NAME}&page_size=50`, token, {
    headers: onInstance(team),
  })) as { list: Row[] };
  return Object.fromEntries(res.list.map((r) => [r.value.id, r.value.__team_id]));
};

test.beforeAll(async () => {
  const admin = await loginAdmin();
  mine = await ensureTeam(admin, { name: `${PREFIX}-a` });
  alsoMine = await ensureTeam(admin, { name: `${PREFIX}-b` });
  theirs = await ensureTeam(admin, { name: `${PREFIX}-c` });

  const user = await ensureUser(admin, { username: `${PREFIX}-dev`, password: PASSWORD });
  assignment = await ensureUserInstanceRole(admin, user.id, fx().localInstanceId, {
    role: 'developer',
    team_ids: [mine.id, alsoMine.id],
  });

  // One route for each team: for an admin, X-Team-ID is the owner a write records.
  for (const [id, team] of [
    [routeOf.mine, mine.id],
    [routeOf.alsoMine, alsoMine.id],
    [routeOf.theirs, theirs.id],
  ]) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, {
      method: 'PUT',
      headers: onInstance(team),
      json: route(id),
    });
  }
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  // Routes first: a team that still owns one cannot be deleted. Then the user,
  // whose assignment names the teams. Whatever this run's name is on, not a
  // list kept by hand: a create that should have been refused and was not is
  // exactly the route such a list would not hold.
  const left = await listed(admin).catch(() => ({}));
  for (const id of Object.keys(left)) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => undefined);
  }
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

test('an assignment holds every team it is given', async () => {
  expect(assignment.team_ids).toEqual([mine.id, alsoMine.id]);
  // The first of them, under the name the answer had when it held one team.
  expect(assignment.team_id).toBe(mine.id);

  // The list of teams is an admin's to read, so this is where a developer
  // learns what theirs are called.
  const me = (await apiFetch('/api/v1/user', await devToken(), { headers: onInstance() })) as {
    team_ids: string[];
    teams: { id: string; name: string }[];
  };
  expect(me.team_ids).toEqual([mine.id, alsoMine.id]);
  expect(me.teams).toEqual([
    { id: mine.id, name: mine.name },
    { id: alsoMine.id, name: alsoMine.name },
  ]);
});

test('a developer sees the routes of every team they work for, and of no other', async () => {
  expect(await listed(await devToken())).toEqual({
    [routeOf.mine]: mine.id,
    [routeOf.alsoMine]: alsoMine.id,
  });
});

test('naming one of their teams narrows the list to it', async () => {
  expect(await listed(await devToken(), alsoMine.id)).toEqual({
    [routeOf.alsoMine]: alsoMine.id,
  });
});

test('a route of a team they did not name is still theirs to open and change', async () => {
  const dev = await devToken();
  const named = onInstance(alsoMine.id);

  const read = (await apiFetch(`${PROXY}/routes/${routeOf.mine}`, dev, { headers: named })) as Row;
  expect(read.value.__team_id).toBe(mine.id);

  await apiFetch(`${PROXY}/routes/${routeOf.mine}`, dev, {
    method: 'PUT',
    headers: named,
    json: { ...route(routeOf.mine), desc: 'changed for the other team' },
  });
  // Changed, and still the team's it was: the team named is where a create
  // goes, not where an update moves things.
  const after = (await apiFetch(`${PROXY}/routes/${routeOf.mine}`, await loginAdmin(), {
    headers: onInstance(),
  })) as Row;
  expect(after.value.desc).toBe('changed for the other team');
  expect(after.value.__team_id).toBe(mine.id);
});

test('another team’s route stays out of reach', async () => {
  const dev = await devToken();
  const read = await refusal(
    apiFetch(`${PROXY}/routes/${routeOf.theirs}`, dev, { headers: onInstance() })
  );
  expect(read?.status).toBe(403);

  const write = await refusal(
    apiFetch(`${PROXY}/routes/${routeOf.theirs}`, dev, {
      method: 'PUT',
      headers: onInstance(),
      json: route(routeOf.theirs),
    })
  );
  expect(write?.status).toBe(403);
});

test('naming a team that is not theirs is refused, not answered for another', async () => {
  const dev = await devToken();
  for (const request of [
    apiFetch(`${PROXY}/routes?name=${ROUTE_NAME}`, dev, { headers: onInstance(theirs.id) }),
    apiFetch(`${PROXY}/routes/${routeOf.mine}`, dev, { headers: onInstance(theirs.id) }),
  ]) {
    const refused = await refusal(request);
    expect(refused?.status).toBe(403);
    expect(refused?.message).toContain('team_not_assigned');
  }
});

test('a new route needs to be told which team it is for', async () => {
  const dev = await devToken();
  const admin = await loginAdmin();
  const byPost = `${ROUTE_NAME}-post`;
  const byPut = `${ROUTE_NAME}-put`;

  // Both ways a route is created: a POST to the collection, and a PUT to an
  // id that does not exist yet.
  const posted = await refusal(
    apiFetch(`${PROXY}/routes`, dev, {
      method: 'POST',
      headers: onInstance(),
      json: route(byPost),
    })
  );
  expect(posted?.status).toBe(400);
  expect(posted?.message).toContain('team_required');

  const put = await refusal(
    apiFetch(`${PROXY}/routes/${byPut}`, dev, {
      method: 'PUT',
      headers: onInstance(),
      json: route(byPut),
    })
  );
  expect(put?.status).toBe(400);
  expect(put?.message).toContain('team_required');

  // Refused before the gateway: nothing was written for an admin to find
  // without a team, which is what an ownerless create would have left.
  expect(Object.keys(await listed(admin)).sort()).toEqual(
    [routeOf.mine, routeOf.alsoMine, routeOf.theirs].sort()
  );
});

test('deleting a route that is already gone is the gateway’s 404, not a question about teams', async () => {
  const gone = await refusal(
    apiFetch(`${PROXY}/routes/${ROUTE_NAME}-gone`, await devToken(), {
      method: 'DELETE',
      headers: onInstance(),
    })
  );
  expect(gone?.status).toBe(404);
});

test('and belongs to the team that was named', async () => {
  const dev = await devToken();
  const id = `${ROUTE_NAME}-new`;

  await apiFetch(`${PROXY}/routes/${id}`, dev, {
    method: 'PUT',
    headers: onInstance(alsoMine.id),
    json: route(id),
  });

  expect((await listed(await loginAdmin()))[id]).toBe(alsoMine.id);
  // And is theirs whichever team they name next, or none.
  expect((await listed(dev))[id]).toBe(alsoMine.id);
});
