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

/**
 * Idempotent REST seed client for provisioning multi-tenant E2E fixtures.
 *
 * Each ensure-* helper does a GET to find an existing entity by name/username
 * and POSTs only if missing. ensureUserInstanceRole always POSTs because the
 * backend's SetUserInstanceRole is a pure upsert (PutJSON — idempotent).
 */

const API_URL = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8086';

// ---------------------------------------------------------------------------
// Shared types mirroring api/internal/models/models.go
// ---------------------------------------------------------------------------

export type Instance = {
  id: string;
  name: string;
  description: string;
  admin_api_url: string;
  gateway_url: string;
  is_active: boolean;
};

export type Team = {
  id: string;
  name: string;
  description: string;
};

export type User = {
  id: string;
  username: string;
  email: string;
  role: string;
};

export type UserInstance = {
  user_id: string;
  instance_id: string;
  role: string;
  team_id: string;
};

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>;

type FetchOptions = {
  method?: string;
  json?: JsonBody;
};

async function apiFetch(
  path: string,
  token: string,
  options: FetchOptions = {},
): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`[seed] ${options.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }

  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as unknown) : null;
}

// ---------------------------------------------------------------------------
// Login — returns an admin access token
// ---------------------------------------------------------------------------

export async function loginAdmin(username = 'admin', password = 'admin'): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`[seed] login failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// ensureInstance
// ---------------------------------------------------------------------------

export type CreateInstanceInput = {
  name: string;
  description?: string;
  admin_api_url: string;
  admin_key: string;
  gateway_url?: string;
  is_active?: boolean;
};

export async function ensureInstance(token: string, input: CreateInstanceInput): Promise<Instance> {
  const list = (await apiFetch('/api/v1/instances', token)) as Instance[];
  const existing = list.find((i) => i.name === input.name);
  if (existing) {
    return existing;
  }

  const created = await apiFetch('/api/v1/instances', token, {
    method: 'POST',
    json: {
      name: input.name,
      description: input.description ?? '',
      admin_api_url: input.admin_api_url,
      admin_key: input.admin_key,
      gateway_url: input.gateway_url ?? '',
      is_active: input.is_active ?? true,
    },
  });
  return created as Instance;
}

// ---------------------------------------------------------------------------
// ensureTeam
// ---------------------------------------------------------------------------

export type CreateTeamInput = {
  name: string;
  description?: string;
};

export async function ensureTeam(token: string, input: CreateTeamInput): Promise<Team> {
  const list = (await apiFetch('/api/v1/teams', token)) as Team[];
  const existing = list.find((t) => t.name === input.name);
  if (existing) {
    return existing;
  }

  const created = await apiFetch('/api/v1/teams', token, {
    method: 'POST',
    json: {
      name: input.name,
      description: input.description ?? '',
    },
  });
  return created as Team;
}

// ---------------------------------------------------------------------------
// ensureUser
// ---------------------------------------------------------------------------

export type CreateUserInput = {
  username: string;
  password: string;
  email?: string;
  /** Global role — only 'super_admin' or '' (empty) are accepted by the backend. */
  role?: string;
};

export async function ensureUser(token: string, input: CreateUserInput): Promise<User> {
  const list = (await apiFetch('/api/v1/users', token)) as User[];
  const existing = list.find((u) => u.username === input.username);
  if (existing) {
    return existing;
  }

  const created = await apiFetch('/api/v1/users', token, {
    method: 'POST',
    json: {
      username: input.username,
      password: input.password,
      email: input.email ?? '',
      role: input.role ?? '',
    },
  });
  return created as User;
}

// ---------------------------------------------------------------------------
// ensureUserInstanceRole
//
// The backend's SetUserInstanceRole is a pure upsert (PutJSON to etcd), so
// calling POST multiple times is idempotent — no pre-flight GET needed.
//
// IMPORTANT: The backend requires team_id for BOTH developer and viewer roles
// (api/internal/handlers/instance.go:284-289). Callers must always pass a
// non-empty team_id for these roles.
// ---------------------------------------------------------------------------

export type UserInstanceRoleInput = {
  role: string;
  /** Required for developer and viewer roles. */
  team_id: string;
};

export async function ensureUserInstanceRole(
  token: string,
  userId: string,
  instanceId: string,
  input: UserInstanceRoleInput,
): Promise<UserInstance> {
  const result = await apiFetch(
    `/api/v1/user-access/${userId}/instances/${instanceId}/role`,
    token,
    {
      method: 'POST',
      json: {
        role: input.role,
        team_id: input.team_id,
      },
    },
  );
  return result as UserInstance;
}
