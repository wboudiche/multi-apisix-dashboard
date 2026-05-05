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

import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8086';
const INSTANCE_ID = '83c346e5-1f26-4c13-ad73-8681747f8b9e';

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  return data.access_token;
}

function headers(token: string, instanceId?: string) {
  const h: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (instanceId) h['X-Instance-ID'] = instanceId;
  return h;
}

test.describe('Authentication', () => {
  test('valid login returns tokens', async () => {
    const res = await fetch(`${API}/api/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.access_token).toBeTruthy();
    expect(data.refresh_token).toBeTruthy();
    expect(data.expires_in).toBeGreaterThan(0);
  });

  test('wrong password returns 401', async () => {
    const res = await fetch(`${API}/api/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  test('invalid token returns 401', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      headers: { 'Authorization': 'Bearer invalid-token' },
    });
    expect(res.status).toBe(401);
  });

  test('missing auth header returns 401', async () => {
    const res = await fetch(`${API}/api/v1/instances`);
    expect(res.status).toBe(401);
  });

  test('token refresh works', async () => {
    const loginRes = await fetch(`${API}/api/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    const { refresh_token } = await loginRes.json();

    const res = await fetch(`${API}/api/v1/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.access_token).toBeTruthy();
  });
});

test.describe('User Management', () => {
  let adminToken: string;

  test.beforeAll(async () => {
    adminToken = await login('admin', 'admin');
  });

  test('list users as admin', async () => {
    const res = await fetch(`${API}/api/v1/users`, {
      headers: headers(adminToken),
    });
    expect(res.status).toBe(200);
    const users = await res.json();
    expect(users.length).toBeGreaterThan(0);
    expect(users.some((u: any) => u.username === 'admin')).toBe(true);
  });

  test('non-admin cannot list users', async () => {
    const devToken = await login('dev_user', 'dev123');
    const res = await fetch(`${API}/api/v1/users`, {
      headers: headers(devToken),
    });
    expect(res.status).toBe(403);
  });

  test('non-admin cannot create users', async () => {
    const devToken = await login('dev_user', 'dev123');
    const res = await fetch(`${API}/api/v1/users`, {
      method: 'POST',
      headers: headers(devToken),
      body: JSON.stringify({ username: 'hack', password: 'hack123', role: 'super_admin' }),
    });
    expect(res.status).toBe(403);
  });
});

test.describe('RBAC - Role Based Access Control', () => {
  let adminToken: string;
  let devToken: string;
  let viewerToken: string;

  test.beforeAll(async () => {
    adminToken = await login('admin', 'admin');
    devToken = await login('dev_user', 'dev123');
    viewerToken = await login('viewer_user', 'view123');
  });

  test('developer can list routes', async () => {
    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(devToken, INSTANCE_ID),
    });
    expect(res.status).toBe(200);
  });

  test('viewer can list routes (read access)', async () => {
    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(viewerToken, INSTANCE_ID),
    });
    expect(res.status).toBe(200);
  });

  test('viewer cannot create routes', async () => {
    const res = await fetch(`${API}/api/v1/apisix/admin/routes/viewer-test`, {
      method: 'PUT',
      headers: headers(viewerToken, INSTANCE_ID),
      body: JSON.stringify({ uri: '/viewer-blocked', upstream: { type: 'roundrobin', nodes: { 'httpbin.org:80': 1 } } }),
    });
    expect(res.status).toBe(403);
  });

  test('developer cannot create instances', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      method: 'POST',
      headers: headers(devToken),
      body: JSON.stringify({ name: 'Hacked', admin_api_url: 'http://evil.com', admin_key: 'key' }),
    });
    expect(res.status).toBe(403);
  });

  test('request without X-Instance-ID returns 400', async () => {
    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(devToken),
    });
    expect(res.status).toBe(400);
  });
});

test.describe('Multi-Instance', () => {
  let adminToken: string;
  let devToken: string;
  let viewerToken: string;

  test.beforeAll(async () => {
    adminToken = await login('admin', 'admin');
    devToken = await login('dev_user', 'dev123');
    viewerToken = await login('viewer_user', 'view123');
  });

  test('admin sees all instances', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      headers: headers(adminToken),
    });
    expect(res.status).toBe(200);
    const instances = await res.json();
    expect(instances.length).toBeGreaterThanOrEqual(2);
  });

  test('viewer sees only assigned instances', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      headers: headers(viewerToken),
    });
    expect(res.status).toBe(200);
    const instances = await res.json();
    expect(instances.length).toBe(1);
    expect(instances[0].name).toBe('Local APISIX');
  });

  test('viewer cannot access unassigned instance', async () => {
    // Get staging instance ID
    const allRes = await fetch(`${API}/api/v1/instances`, {
      headers: headers(adminToken),
    });
    const all = await allRes.json();
    const staging = all.find((i: any) => i.name === 'Staging APISIX');
    if (!staging) return;

    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(viewerToken, staging.id),
    });
    expect(res.status).toBe(403);
  });
});

test.describe('Teams', () => {
  let adminToken: string;
  let devToken: string;

  test.beforeAll(async () => {
    adminToken = await login('admin', 'admin');
    devToken = await login('dev_user', 'dev123');
  });

  test('list teams', async () => {
    const res = await fetch(`${API}/api/v1/teams`, {
      headers: headers(adminToken),
    });
    expect(res.status).toBe(200);
    const teams = await res.json();
    expect(teams.length).toBeGreaterThan(0);
  });

  test('non-admin cannot create teams', async () => {
    const res = await fetch(`${API}/api/v1/teams`, {
      method: 'POST',
      headers: headers(devToken),
      body: JSON.stringify({ name: 'Hack Team', description: 'nope' }),
    });
    expect(res.status).toBe(403);
  });

  test('non-admin cannot delete teams', async () => {
    const teamsRes = await fetch(`${API}/api/v1/teams`, {
      headers: headers(adminToken),
    });
    const teams = await teamsRes.json();
    const team = teams[0];

    const res = await fetch(`${API}/api/v1/teams/${team.id}`, {
      method: 'DELETE',
      headers: headers(devToken),
    });
    expect(res.status).toBe(403);
  });
});

test.describe('Team Ownership', () => {
  test.describe.configure({ mode: 'serial' });
  let adminToken: string;
  let devToken: string;
  let frontToken: string;
  let viewerToken: string;
  const routeId = 'ownership-test-route';

  test.beforeAll(async () => {
    adminToken = await login('admin', 'admin');
    devToken = await login('dev_user', 'dev123');
    frontToken = await login('frontend_dev', 'front123');
    viewerToken = await login('viewer_user', 'view123');
  });

  test.afterAll(async () => {
    // Cleanup
    await fetch(`${API}/api/v1/apisix/admin/routes/${routeId}`, {
      method: 'DELETE',
      headers: headers(adminToken, INSTANCE_ID),
    });
  });

  test('developer creates route with team ownership', async () => {
    const res = await fetch(`${API}/api/v1/apisix/admin/routes/${routeId}`, {
      method: 'PUT',
      headers: headers(devToken, INSTANCE_ID),
      body: JSON.stringify({
        uri: '/ownership-test',
        upstream: { type: 'roundrobin', nodes: { 'httpbin.org:80': 1 } },
        name: 'ownership-test-route',
      }),
    });
    expect(res.status).toBe(201);
  });

  test('owner team can see the route in list', async () => {
    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(devToken, INSTANCE_ID),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const names = data.list.map((r: any) => r.value.name);
    expect(names).toContain('ownership-test-route');
  });

  test('other team cannot see the route in list', async () => {
    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(frontToken, INSTANCE_ID),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const names = data.list.map((r: any) => r.value.name);
    expect(names).not.toContain('ownership-test-route');
  });

  test('other team cannot access the route directly', async () => {
    const res = await fetch(`${API}/api/v1/apisix/admin/routes/${routeId}`, {
      headers: headers(frontToken, INSTANCE_ID),
    });
    // Returns 403 (blocked by ownership) or 404 (not found for this team)
    expect([403, 404]).toContain(res.status);
  });

  test('other team cannot delete the route', async () => {
    const res = await fetch(`${API}/api/v1/apisix/admin/routes/${routeId}`, {
      method: 'DELETE',
      headers: headers(frontToken, INSTANCE_ID),
    });
    expect(res.status).toBe(403);
  });

  test('viewer (no team) cannot see team-owned route', async () => {
    const res = await fetch(`${API}/api/v1/apisix/routes`, {
      headers: headers(viewerToken, INSTANCE_ID),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const names = data.list.map((r: any) => r.value.name);
    expect(names).not.toContain('ownership-test-route');
  });

  test('admin can access team-owned route directly (bypasses ownership)', async () => {
    const res = await fetch(`${API}/api/v1/apisix/admin/routes/${routeId}`, {
      headers: headers(adminToken, INSTANCE_ID),
    });
    expect(res.status).toBe(200);
  });

  test('owner can update the route', async () => {
    const res = await fetch(`${API}/api/v1/apisix/admin/routes/${routeId}`, {
      method: 'PUT',
      headers: headers(devToken, INSTANCE_ID),
      body: JSON.stringify({
        uri: '/ownership-test-updated',
        upstream: { type: 'roundrobin', nodes: { 'httpbin.org:80': 1 } },
        name: 'ownership-test-route',
      }),
    });
    // APISIX PUT returns 200 (update) or 201 (create)
    expect([200, 201]).toContain(res.status);
  });
});

test.describe('Overview', () => {
  test('overview returns real resource counts', async () => {
    const token = await login('admin', 'admin');
    const res = await fetch(`${API}/api/v1/overview?refresh=true`, {
      headers: headers(token),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.global_stats.routes).toBeGreaterThan(0);
    expect(data.total_instances).toBeGreaterThanOrEqual(2);
    expect(data.active_instances).toBeGreaterThanOrEqual(1);
  });
});
