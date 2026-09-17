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
import { API_URL, apiFetch, loginAdmin } from '@e2e/utils/seed-client';
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
    // Its ownership record goes with it (#248).
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

test('a path with an empty segment is refused, whatever the method', async () => {
  // APISIX collapses it, writing /routes//<id> to /routes/<id>, while the
  // proxy, reading the path segment by segment, saw no resource at all and ran
  // none of the checks that need one (#191).
  const id = randomId('coll').replace(/-/g, '_');
  created.push(`routes/${id}`);
  await apiFetch(`${PROXY}/routes/${id}`, await loginAdmin(), {
    method: 'PUT',
    headers: { ...onInstance(), 'X-Team-ID': fx().frontendTeamId },
    json: { uri: `/${id}`, desc: 'theirs', upstream },
  });
  expect(await stored('routes', id)).toEqual({ team: fx().frontendTeamId, desc: 'theirs' });

  const dev = await devToken();
  await expect(
    apiFetch(`${PROXY}/routes//${id}`, dev, {
      method: 'PUT',
      headers: onInstance(),
      json: { uri: `/${id}`, desc: 'mine now', upstream },
    })
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    apiFetch(`${PROXY}/routes//${id}`, dev, { method: 'DELETE', headers: onInstance() })
  ).rejects.toMatchObject({ status: 400 });

  expect(await stored('routes', id)).toEqual({ team: fx().frontendTeamId, desc: 'theirs' });
});

test('a numeric id APISIX would key differently is refused', async () => {
  // APISIX keys a number by its value, writing {"id": <n>.0} to /routes/<n>,
  // while the proxy read the literal and checked a resource that did not
  // exist (#191).
  const id = String(9_000_000_000 + Math.floor(Math.random() * 999_999_999));
  created.push(`routes/${id}`);
  await apiFetch(`${PROXY}/routes/${id}`, await loginAdmin(), {
    method: 'PUT',
    headers: { ...onInstance(), 'X-Team-ID': fx().frontendTeamId },
    json: { uri: `/${id}`, desc: 'theirs', upstream },
  });
  expect(await stored('routes', id)).toEqual({ team: fx().frontendTeamId, desc: 'theirs' });

  // Sent raw: JSON.stringify writes <n>.0 as <n>.
  const body = JSON.stringify({ id: 0, uri: `/${id}`, desc: 'mine now', upstream }).replace(
    '"id":0',
    `"id":${id}.0`
  );
  const res = await fetch(`${API_URL}${PROXY}/routes`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await devToken()}`,
      ...onInstance(),
    },
    body,
  });
  expect(res.status).toBe(400);

  expect(await stored('routes', id)).toEqual({ team: fx().frontendTeamId, desc: 'theirs' });
});

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
