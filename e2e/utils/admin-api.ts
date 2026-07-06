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
  apiFetch,
  type FetchOptions,
  HttpError,
  type Instance,
  loginAdmin,
  type Team,
  type User,
} from './seed-client';

// Access tokens expire after 15 minutes; re-login well before that so a
// long-running CI worker (one process runs a whole shard of spec files,
// sharing this module's cache) never carries a stale token into a later
// spec's beforeAll/afterAll.
const TOKEN_TTL_MS = 10 * 60 * 1000;

let cachedToken: string | null = null;
let tokenMintedAt = 0;

export async function adminToken(): Promise<string> {
  if (cachedToken === null || Date.now() - tokenMintedAt > TOKEN_TTL_MS) {
    cachedToken = await loginAdmin();
    tokenMintedAt = Date.now();
  }
  return cachedToken;
}

async function adminFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  return (await apiFetch(path, await adminToken(), options)) as T;
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

export const getOverview = (opts?: { refresh?: boolean }) =>
  adminFetch<OverviewData>(
    opts?.refresh ? '/api/v1/overview?refresh=true' : '/api/v1/overview'
  );

const deleteQuietly = async (path: string) => {
  try {
    await adminFetch(path, { method: 'DELETE' });
  } catch (err) {
    // already gone — cleanup must be idempotent (tolerate 404 only)
    if (!(err instanceof HttpError) || err.status !== 404) {
      throw err;
    }
  }
};

const deleteByPrefix = async <T>(
  list: () => Promise<T[]>,
  nameOf: (item: T) => string,
  idOf: (item: T) => string,
  basePath: string,
  prefix: string,
): Promise<void> => {
  const matched = (await list()).filter((item) => nameOf(item).startsWith(prefix));
  await Promise.all(matched.map((item) => deleteQuietly(`${basePath}/${idOf(item)}`)));
};

// Callers that clean up users AND teams must delete users first — removing a
// user also removes the user_instances records that reference the team.
export const deleteTeamsByPrefix = (prefix: string) =>
  deleteByPrefix(listTeams, (t) => t.name, (t) => t.id, '/api/v1/teams', prefix);
export const deleteUsersByPrefix = (prefix: string) =>
  deleteByPrefix(listUsers, (u) => u.username, (u) => u.id, '/api/v1/users', prefix);
export const deleteInstancesByPrefix = (prefix: string) =>
  deleteByPrefix(listInstances, (i) => i.name, (i) => i.id, '/api/v1/instances', prefix);
