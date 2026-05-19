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
 * Synchronous loader for the fixture JSON written by global-setup.ts.
 *
 * Call getFixtures() from any test or helper that needs stable IDs for
 * instances, teams, or users provisioned during global setup.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FixtureUser = {
  id: string;
  username: string;
  password: string;
};

export type Fixtures = {
  localInstanceId: string;
  stagingInstanceId: string;
  backendTeamId: string;
  frontendTeamId: string;
  /** Team assigned to viewer_user (required because backend enforces team_id for viewer role). */
  viewersTeamId: string;
  users: {
    admin: FixtureUser;
    dev: FixtureUser;
    frontend: FixtureUser;
    viewer: FixtureUser;
  };
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(import.meta.dirname, '..', '.fixtures.json');

let cached: Fixtures | null = null;

/**
 * Synchronously loads and caches e2e/.fixtures.json.
 * Throws a descriptive error if the file is missing (i.e. global setup has
 * not been run yet).
 */
export function getFixtures(): Fixtures {
  if (cached !== null) {
    return cached;
  }

  let raw: string;
  try {
    raw = readFileSync(FIXTURE_PATH, 'utf-8');
  } catch {
    throw new Error(
      `[fixtures] e2e/.fixtures.json not found at ${FIXTURE_PATH}.\n` +
        'Run Playwright with the globalSetup configured in playwright.config.ts, ' +
        'or ensure the backend is running and re-run the test suite.',
    );
  }

  cached = JSON.parse(raw) as Fixtures;
  return cached;
}
