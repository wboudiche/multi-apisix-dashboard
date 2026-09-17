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
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * Who owns a resource after someone edits it.
 *
 * The proxy recorded the writing team on every successful write, and an admin
 * sends whichever team their header has selected. So an admin editing another
 * team's route handed it to that team, and its developers lost sight of it
 * without a word (#260). Reassigning has an action of its own.
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const route = (id: string, desc: string) => ({
  uri: `/${id}`,
  name: id,
  desc,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});

const ids: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const id of ids.splice(0)) {
    await apiFetch(`${PROXY}/routes/${id}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => undefined);
  }
});

/** A route owned by `team`, created by an admin who has it selected. */
const routeOwnedBy = async (token: string, team: string) => {
  const id = randomId('e2e-own-update');
  ids.push(id);
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(team),
    json: route(id, 'created'),
  });
  return id;
};

/** The team a route belongs to, and its description, as an admin reads them. */
const stored = async (token: string, id: string) => {
  const res = (await apiFetch(`${PROXY}/routes/${id}`, token, {
    headers: onInstance(),
  })) as { value: { desc?: string; __team_id?: string } };
  return { team: res.value.__team_id ?? '', desc: res.value.desc };
};

test("an admin editing another team's route leaves it with that team", async () => {
  const token = await loginAdmin();
  const id = await routeOwnedBy(token, fx().backendTeamId);
  expect(await stored(token, id)).toMatchObject({ team: fx().backendTeamId });

  // The same admin, with another team selected, edits it.
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(fx().frontendTeamId),
    json: route(id, 'edited'),
  });

  // The edit lands; the team does not move with it.
  expect(await stored(token, id)).toEqual({ team: fx().backendTeamId, desc: 'edited' });
});

test('a resource created with a team selected still belongs to it', async () => {
  const token = await loginAdmin();

  const id = await routeOwnedBy(token, fx().frontendTeamId);

  expect(await stored(token, id)).toMatchObject({ team: fx().frontendTeamId });
});

test('reassigning still moves a route between teams', async () => {
  const token = await loginAdmin();
  const id = await routeOwnedBy(token, fx().backendTeamId);

  await apiFetch(`/api/v1/apisix/ownership/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: { team_id: fx().frontendTeamId },
  });

  expect(await stored(token, id)).toMatchObject({ team: fx().frontendTeamId });
});
