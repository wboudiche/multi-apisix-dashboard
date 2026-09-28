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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The route test sends a request through the instance's gateway. Since #309 the
 * caller must be able to write routes on that instance; nothing narrowed the
 * request to the caller's team, so a developer in one team could send a DELETE
 * at a route of another team's that they cannot even see in the list (#311).
 *
 * Through the API rather than a page: the drawer only ever opens on a route the
 * caller is looking at, which is exactly why the endpoint had to be checked
 * itself.
 */

const PROXY = '/api/v1/apisix/admin';
const MINE = 'e2e-route-test-mine';
const THEIRS = 'e2e-route-test-theirs';
const UNOWNED = 'e2e-route-test-unowned';

const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

const seed = async (token: string, id: string, teamId?: string) => {
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: {
      uri: `/${id}`,
      name: id,
      upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
    },
  });
  if (teamId) {
    await apiFetch(`/api/v1/apisix/ownership/routes/${id}`, token, {
      method: 'PUT',
      headers: onInstance(),
      json: { team_id: teamId },
    });
  }
};

/** The status of a route test, whatever the gateway then answered. */
const testRouteStatus = async (token: string, routeId: string, path: string) => {
  try {
    await apiFetch('/api/v1/test-route', token, {
      method: 'POST',
      headers: onInstance(),
      json: { route_id: routeId, method: 'GET', path },
    });
    return 200;
  } catch (err) {
    if (err instanceof HttpError) return err.status;
    throw err;
  }
};

test.beforeAll(async () => {
  const token = await loginAdmin();
  // dev_user is a developer in the Backend team on this instance.
  await seed(token, MINE, fx().backendTeamId);
  await seed(token, THEIRS, fx().frontendTeamId);
  await seed(token, UNOWNED);
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const id of [MINE, THEIRS, UNOWNED]) {
    await apiFetch(`${PROXY}/routes/${id}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => undefined);
  }
});

test('a developer tests their own team’s route and no other', async () => {
  const dev = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

  expect(await testRouteStatus(dev, MINE, `/${MINE}`)).toBe(200);
  expect(await testRouteStatus(dev, THEIRS, `/${THEIRS}`)).toBe(403);
  // A route with no team is administrative territory here as everywhere else.
  expect(await testRouteStatus(dev, UNOWNED, `/${UNOWNED}`)).toBe(403);
});

test('naming one route and asking for another path is refused', async () => {
  const dev = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

  // The team check would pass - this route is theirs - and the path is not one
  // it matches, which is how the endpoint could still have been pointed
  // anywhere.
  expect(await testRouteStatus(dev, MINE, `/${THEIRS}`)).toBe(400);
});

test('an admin tests any team’s route, and no route that does not exist', async () => {
  const token = await loginAdmin();

  expect(await testRouteStatus(token, THEIRS, `/${THEIRS}`)).toBe(200);
  expect(await testRouteStatus(token, 'e2e-no-such-route', '/whatever')).toBe(404);
});
