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
 * APISIX also takes a PUT addressed to a collection, with the resource named
 * in the body — the username for a consumer, the id for the rest — and writes
 * it there. The proxy read the id from the path only, so its checks that need
 * one never ran for such a PUT: a developer's write reached another team's
 * resource, and the ownership recorded after the write then gave it to the
 * developer's team (#191).
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });
const upstream = {
  type: 'roundrobin',
  nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }],
};

/** Team-owned resources a developer may write, each with its body for an id. */
const CASES = [
  {
    type: 'consumers',
    body: (id: string, desc: string) => ({ username: id, desc }),
  },
  {
    type: 'routes',
    body: (id: string, desc: string) => ({ id, uri: `/${id}`, desc, upstream }),
  },
  {
    type: 'upstreams',
    body: (id: string, desc: string) => ({ id, desc, ...upstream }),
  },
] as const;

// `<type>/<id>` of everything a test made, torn down even when it fails.
const created: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const key of created.splice(0)) {
    // The ownership record first: deleting the resource does not remove it.
    await apiFetch(`/api/v1/apisix/ownership/${key}`, token, {
      method: 'PUT',
      headers: onInstance(),
      json: { team_id: '' },
    }).catch(() => undefined);
    await apiFetch(`${PROXY}/${key}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => undefined);
  }
});

const devToken = () =>
  loginAdmin(fx().users.dev.username, fx().users.dev.password);

/** A resource's team and description, as an admin's list shows them. */
const stored = async (type: string, id: string) => {
  const res = (await apiFetch(`${PROXY}/${type}`, await loginAdmin(), {
    headers: onInstance(),
  })) as {
    list: {
      value: { id?: string; username?: string; desc?: string; __team_id?: string };
    }[];
  };
  const row = res.list.find((r) => (r.value.id ?? r.value.username) === id);
  return row ? { team: row.value.__team_id ?? '', desc: row.value.desc } : undefined;
};

for (const c of CASES) {
  test(`a developer cannot write another team's ${c.type} by addressing the collection`, async () => {
    const id = randomId('coll').replace(/-/g, '_');
    created.push(`${c.type}/${id}`);
    // Frontend Team's: for an admin, X-Team-ID is the owner a write records.
    await apiFetch(`${PROXY}/${c.type}/${id}`, await loginAdmin(), {
      method: 'PUT',
      headers: { ...onInstance(), 'X-Team-ID': fx().frontendTeamId },
      json: c.body(id, 'theirs'),
    });
    // Asserted first, so that "unchanged" below is measured against it.
    expect(await stored(c.type, id)).toEqual({ team: fx().frontendTeamId, desc: 'theirs' });

    // The developer is on Backend Team.
    const write = apiFetch(`${PROXY}/${c.type}`, await devToken(), {
      method: 'PUT',
      headers: onInstance(),
      json: c.body(id, 'mine now'),
    });
    await expect(write).rejects.toMatchObject({ status: 403 });

    // Neither its content nor its team moved.
    expect(await stored(c.type, id)).toEqual({ team: fx().frontendTeamId, desc: 'theirs' });
  });
}

test('a developer still creates a consumer the way the Add page sends it, and owns it', async () => {
  const id = randomId('coll').replace(/-/g, '_');
  created.push(`consumers/${id}`);

  await apiFetch(`${PROXY}/consumers`, await devToken(), {
    method: 'PUT',
    headers: { ...onInstance(), 'If-None-Match': '*' },
    json: { username: id, desc: 'new' },
  });

  expect(await stored('consumers', id)).toEqual({ team: fx().backendTeamId, desc: 'new' });
});
