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
import {
  type Instance,
  loginAdmin,
  type Team,
  type User,
} from './seed-client';

const API_URL = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8086';

let cachedToken: string | null = null;

export async function adminToken(): Promise<string> {
  if (cachedToken === null) {
    cachedToken = await loginAdmin();
  }
  return cachedToken;
}

type FetchOptions = {
  method?: string;
  json?: Record<string, unknown>;
};

async function adminFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const token = await adminToken();
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
    const err = new Error(`[admin-api] ${options.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const text = await res.text();
  return (text.length > 0 ? JSON.parse(text) : null) as T;
}

export const listTeams = () => adminFetch<Team[]>('/api/v1/teams');
export const listUsers = () => adminFetch<User[]>('/api/v1/users');
export const listInstances = () => adminFetch<Instance[]>('/api/v1/instances');

export type OverviewData = {
  total_instances: number;
  active_instances: number;
  global_stats: {
    routes: number;
    services: number;
    upstreams: number;
  };
};

export const getOverview = () => adminFetch<OverviewData>('/api/v1/overview');

const deleteQuietly = async (path: string) => {
  try {
    await adminFetch(path, { method: 'DELETE' });
  } catch (err) {
    // already gone — cleanup must be idempotent (tolerate 404 only)
    const status = (err as Error & { status?: number }).status;
    if (status !== 404) {
      throw err;
    }
  }
};

export async function deleteTeamsByPrefix(prefix: string): Promise<void> {
  const teams = await listTeams();
  for (const team of teams.filter((t) => t.name.startsWith(prefix))) {
    await deleteQuietly(`/api/v1/teams/${team.id}`);
  }
}

export async function deleteUsersByPrefix(prefix: string): Promise<void> {
  const users = await listUsers();
  for (const user of users.filter((u) => u.username.startsWith(prefix))) {
    await deleteQuietly(`/api/v1/users/${user.id}`);
  }
}

export async function deleteInstancesByPrefix(prefix: string): Promise<void> {
  const instances = await listInstances();
  for (const inst of instances.filter((i) => i.name.startsWith(prefix))) {
    await deleteQuietly(`/api/v1/instances/${inst.id}`);
  }
}
