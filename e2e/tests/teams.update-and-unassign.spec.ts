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
import { apiFetch, HttpError, loginAdmin, type Team } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * Covers the two halves of the team-management gap: a team could be created
 * and deleted but never edited, and a resource could be moved between teams but
 * never detached from one.
 */

const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

const ROUTE_ID = 'e2e-team-unassign-route';

const status = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

const createTeam = async (token: string, name: string): Promise<Team> =>
  (await apiFetch('/api/v1/teams', token, {
    method: 'POST',
    json: { name, description: 'created by e2e' },
  })) as Team;

const deleteTeam = (token: string, id: string) =>
  apiFetch(`/api/v1/teams/${id}`, token, { method: 'DELETE' }).catch(() => null);

// ---------------------------------------------------------------------------
// Editing a team
// ---------------------------------------------------------------------------

test('renames a team and edits its description in place', async () => {
  const token = await loginAdmin();
  const team = await createTeam(token, `e2e-rename-${Date.now()}`);

  try {
    await apiFetch(`/api/v1/teams/${team.id}`, token, {
      method: 'PUT',
      json: { name: 'e2e renamed team', description: 'now with a description' },
    });

    const after = (await apiFetch('/api/v1/teams', token)) as Team[];
    const found = after.find((t) => t.id === team.id);

    // The id has to survive the edit: it is what every ownership record points
    // at, so a rename that minted a new id would orphan the team's resources.
    expect(found).toBeDefined();
    expect(found?.id).toBe(team.id);
    expect(found?.name).toBe('e2e renamed team');
    expect(found?.description).toBe('now with a description');
  } finally {
    await deleteTeam(token, team.id);
  }
});

test('refuses to blank out a team name', async () => {
  const token = await loginAdmin();
  const team = await createTeam(token, `e2e-blank-${Date.now()}`);

  try {
    const code = await status(
      apiFetch(`/api/v1/teams/${team.id}`, token, {
        method: 'PUT',
        json: { name: '   ', description: 'still here' },
      })
    );
    expect(code).toBe(400);

    const after = (await apiFetch('/api/v1/teams', token)) as Team[];
    expect(after.find((t) => t.id === team.id)?.name).toBe(team.name);
  } finally {
    await deleteTeam(token, team.id);
  }
});

test('editing an unknown team reports 404 instead of creating one', async () => {
  const token = await loginAdmin();
  const before = ((await apiFetch('/api/v1/teams', token)) as Team[]).length;

  const code = await status(
    apiFetch('/api/v1/teams/no-such-team-id', token, {
      method: 'PUT',
      json: { name: 'conjured out of nothing' },
    })
  );

  // The service layer writes blind, so without the existence check this call
  // would happily bring a team into being at an arbitrary id.
  expect(code).toBe(404);
  expect((await apiFetch('/api/v1/teams', token)) as Team[]).toHaveLength(before);
});

test('an id in the payload cannot redirect the write onto another team', async () => {
  const token = await loginAdmin();
  const target = await createTeam(token, `e2e-target-${Date.now()}`);
  const bystander = await createTeam(token, `e2e-bystander-${Date.now()}`);

  try {
    await apiFetch(`/api/v1/teams/${target.id}`, token, {
      method: 'PUT',
      // A hostile or simply stale body naming a different team.
      json: { id: bystander.id, name: 'renamed via the url id' },
    });

    const after = (await apiFetch('/api/v1/teams', token)) as Team[];
    expect(after.find((t) => t.id === target.id)?.name).toBe('renamed via the url id');
    expect(after.find((t) => t.id === bystander.id)?.name).toBe(bystander.name);
  } finally {
    await deleteTeam(token, target.id);
    await deleteTeam(token, bystander.id);
  }
});

// ---------------------------------------------------------------------------
// Detaching a resource from its team
// ---------------------------------------------------------------------------

test.describe('unassigning a route', () => {
  test.beforeEach(async () => {
    const token = await loginAdmin();
    await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
      method: 'PUT',
      headers: onInstance(),
      json: {
        uri: '/e2e-team-unassign',
        name: 'e2e-team-unassign',
        upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
      },
    });
    // Start owned, so that detaching is an observable change.
    await apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, token, {
      method: 'PUT',
      headers: onInstance(),
      json: { team_id: fx().backendTeamId },
    });
  });

  test.afterEach(async () => {
    const token = await loginAdmin();
    await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => null);
  });

  test('an empty team_id detaches the route, hiding it from its old team', async () => {
    const adminToken = await loginAdmin();
    const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

    // The developer owns it to begin with.
    expect(
      await status(
        apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, { headers: onInstance() })
      )
    ).toBe(200);

    await apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, adminToken, {
      method: 'PUT',
      headers: onInstance(),
      json: { team_id: '' },
    });

    // Unowned means admin-only, so the developer loses sight of it entirely
    // while the admin can still read and reassign it.
    expect(
      await status(
        apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, { headers: onInstance() })
      )
    ).not.toBe(200);
    expect(
      await status(
        apiFetch(`${PROXY}/routes/${ROUTE_ID}`, adminToken, { headers: onInstance() })
      )
    ).toBe(200);
  });

  test('a detached route can be assigned back to a team', async () => {
    const adminToken = await loginAdmin();
    const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

    for (const teamId of ['', fx().backendTeamId]) {
      await apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, adminToken, {
        method: 'PUT',
        headers: onInstance(),
        json: { team_id: teamId },
      });
    }

    expect(
      await status(
        apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, { headers: onInstance() })
      )
    ).toBe(200);
  });

  test('omitting team_id is still rejected rather than read as a detach', async () => {
    const adminToken = await loginAdmin();

    const code = await status(
      apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, adminToken, {
        method: 'PUT',
        headers: onInstance(),
        json: {},
      })
    );
    expect(code).toBe(400);

    // And the existing assignment is untouched by the rejected call.
    const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);
    expect(
      await status(
        apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, { headers: onInstance() })
      )
    ).toBe(200);
  });

  test('a developer cannot detach a route from their own team', async () => {
    const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

    const code = await status(
      apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, devToken, {
        method: 'PUT',
        headers: onInstance(),
        json: { team_id: '' },
      })
    );
    expect(code).toBe(403);
  });
});
