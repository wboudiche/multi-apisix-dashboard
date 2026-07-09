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
 * Playwright globalSetup entrypoint.
 *
 * Provisions two APISIX instances, three teams, and three non-admin users with
 * per-instance role assignments, then writes e2e/.fixtures.json for use by
 * getFixtures() in fixtures.ts.
 *
 * All ensure-* helpers are idempotent: they check for an existing entity before
 * creating, so re-runs against a live backend don't produce duplicates.
 *
 * Note: The backend requires team_id for both developer and viewer roles
 * (api/internal/handlers/instance.go:284-289). Therefore viewer_user is
 * assigned to a dedicated "Viewers Team" rather than being team-less.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Fixtures } from './fixtures';
import {
  ensureInstance,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  loginAdmin,
} from './seed-client';

// Admin key shared by both test APISIX instances in the E2E docker-compose stack.
const APISIX_ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';

// Local APISIX URL: override via E2E_LOCAL_APISIX_URL for docker-network runs.
const LOCAL_APISIX_URL = process.env['E2E_LOCAL_APISIX_URL'] ?? 'http://127.0.0.1:9180';
// Staging APISIX URL: override via E2E_STAGING_APISIX_URL for docker-network runs.
const STAGING_APISIX_URL = process.env['E2E_STAGING_APISIX_URL'] ?? 'http://127.0.0.1:9181';

export default async function globalSetup(): Promise<void> {
  const token = await loginAdmin();

  // ------------------------------------------------------------------
  // 1. Provision instances
  // ------------------------------------------------------------------
  const localInstance = await ensureInstance(token, {
    name: 'Local APISIX',
    description: 'Primary local APISIX instance used in E2E tests',
    admin_api_url: LOCAL_APISIX_URL,
    admin_key: APISIX_ADMIN_KEY,
    is_active: true,
  });

  const stagingInstance = await ensureInstance(token, {
    name: 'Staging APISIX',
    description: 'Secondary APISIX instance used for multi-instance E2E tests',
    admin_api_url: STAGING_APISIX_URL,
    admin_key: APISIX_ADMIN_KEY,
    is_active: true,
  });

  // ------------------------------------------------------------------
  // 2. Provision teams
  // ------------------------------------------------------------------
  const backendTeam = await ensureTeam(token, {
    name: 'Backend Team',
    description: 'Backend engineers team for E2E tests',
  });

  const frontendTeam = await ensureTeam(token, {
    name: 'Frontend Team',
    description: 'Frontend engineers team for E2E tests',
  });

  // The backend requires team_id for both developer AND viewer roles.
  // viewer_user is therefore assigned to a dedicated Viewers Team.
  const viewersTeam = await ensureTeam(token, {
    name: 'Viewers Team',
    description: 'Read-only observers team for E2E tests',
  });

  // ------------------------------------------------------------------
  // 3. Provision users (global role is empty — effective role is per-instance)
  // ------------------------------------------------------------------
  const adminUser = await ensureUser(token, {
    username: 'admin',
    password: 'admin',
    role: 'super_admin',
  });

  const devUser = await ensureUser(token, {
    username: 'dev_user',
    password: 'Dev-User123!',
  });

  const frontendUser = await ensureUser(token, {
    username: 'frontend_dev',
    password: 'Front-Dev123!',
  });

  const viewerUser = await ensureUser(token, {
    username: 'viewer_user',
    password: 'View-User123!',
  });

  // ------------------------------------------------------------------
  // 4. Assign per-instance roles
  // ------------------------------------------------------------------

  // dev_user: developer in Backend Team on Local APISIX
  await ensureUserInstanceRole(token, devUser.id, localInstance.id, {
    role: 'developer',
    team_id: backendTeam.id,
  });

  // frontend_dev: developer in Frontend Team on Local APISIX
  await ensureUserInstanceRole(token, frontendUser.id, localInstance.id, {
    role: 'developer',
    team_id: frontendTeam.id,
  });

  // viewer_user: viewer in Viewers Team on Local APISIX
  // Note: team_id is required by the backend for viewer role.
  await ensureUserInstanceRole(token, viewerUser.id, localInstance.id, {
    role: 'viewer',
    team_id: viewersTeam.id,
  });

  // ------------------------------------------------------------------
  // 5. Write fixture file
  // ------------------------------------------------------------------
  const fixtures: Fixtures = {
    localInstanceId: localInstance.id,
    stagingInstanceId: stagingInstance.id,
    backendTeamId: backendTeam.id,
    frontendTeamId: frontendTeam.id,
    viewersTeamId: viewersTeam.id,
    users: {
      admin: { id: adminUser.id, username: adminUser.username, password: 'admin' },
      dev: { id: devUser.id, username: devUser.username, password: 'Dev-User123!' },
      frontend: { id: frontendUser.id, username: frontendUser.username, password: 'Front-Dev123!' },
      viewer: { id: viewerUser.id, username: viewerUser.username, password: 'View-User123!' },
    },
  };

  const fixturePath = join(import.meta.dirname, '..', '.fixtures.json');
  writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2), 'utf-8');
  console.log(`[global-setup] fixtures written to ${fixturePath}`);
}
