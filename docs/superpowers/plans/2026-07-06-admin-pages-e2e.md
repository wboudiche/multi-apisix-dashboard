# Admin-Pages E2E Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright e2e coverage for the four multi-tenant admin pages (Teams, Instances, Users, Overview) that today have API-level tests only — including the per-instance role-assignment flow verified end-to-end through a real login.

**Architecture:** One spec file per page, parallel-safe via `randomId()` entity names and per-spec name prefixes cleaned up in `afterAll`. Prerequisites not under test are seeded via the existing `e2e/utils/seed-client.ts` helpers; every behavior under test is driven and asserted through the UI. A new `e2e/utils/admin-api.ts` wraps the Go backend's `/api/v1/*` admin endpoints (list/delete/overview) and a new `e2e/pom/admin.ts` holds page navigation/assertion helpers. Two tiny product fixes are included where the current UI blocks a spec requirement: an empty-name guard on the Teams page, and `aria-label`s on the Instances row action icons (they're icon-only buttons that are otherwise unaddressable by role).

**Tech Stack:** Playwright (`@playwright/test`), existing fixtures (`e2e/utils/test.ts` worker-auth, `e2e/utils/fixtures.ts` seeded IDs, `e2e/pom/permission.ts` loginAs), React/Mantine pages under `src/routes/`.

**Spec:** `docs/superpowers/specs/2026-07-05-admin-pages-e2e-design.md`

## Global Constraints

- **ASF license header** required at the top of every new `.ts`/`.tsx` file. Copy this exact block (all new files below start with `/* ASF-HEADER */` as a stand-in for it — replace with the real block; `pnpm lint:fix` can also insert it):

  ```ts
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
  ```

- **Single quotes**, strict TS, `import type` for type-only imports, `simple-import-sort` ordering. Run `pnpm lint:fix <file>` after creating each file; `pnpm lint --max-warnings=0` must pass.
- **Commits:** Conventional Commits with a body explaining *why* (required for `fix:`/`test:`). Scopes used here: `team`, `instance`, `user`, `overview`. No co-author trailers.
- **Test runs** need the full local stack (APISIX `:9180`/`:9181` + etcd via `docker compose -f e2e/server/docker-compose.yml up -d`, Go backend on `:8086`, vite on `:5173`) and `E2E_TARGET_URL=http://127.0.0.1:5173/ui/`.
- **Seeded fixtures are never modified or deleted:** the `admin` user, `Local APISIX` / `Staging APISIX` instances, and global-setup teams/users. All created entities carry a spec-unique random prefix.
- **Native `confirm()` dialogs:** all three admin pages use `window.confirm` for deletes. Register `page.on('dialog', (d) => void d.accept())` before clicking Delete.
- **Deviation from spec (flake control):** Overview assertions use structural checks and `>=` bounds instead of exact equality with a parallel API fetch — the backend caches overview data for 30 s (`api/internal/services/overview.go:119`) while sibling specs create/delete instances and routes concurrently, so exact-count equality between two reads is inherently racy. The spec's own isolation rules already mandate delta/`>=` assertions for Overview.

---

### Task 1: Shared helpers + Teams spec (+ empty-name guard)

**Files:**
- Create: `e2e/utils/admin-api.ts`
- Create: `e2e/pom/admin.ts`
- Create: `e2e/tests/teams.admin.spec.ts`
- Modify: `src/routes/teams/index.tsx:85-103` (handleSubmit — add empty-name guard)

**Interfaces:**
- Consumes: `loginAdmin`, `ensureTeam`, types `Team`/`User`/`Instance` from `e2e/utils/seed-client.ts`; `uiGoto`, `uiHasToastMsg` from `e2e/utils/ui`; `randomId` from `e2e/utils/common.ts`; `test` from `e2e/utils/test.ts`.
- Produces (used by Tasks 2–4):
  - `admin-api.ts`: `adminToken(): Promise<string>`, `listTeams(): Promise<Team[]>`, `listUsers(): Promise<User[]>`, `listInstances(): Promise<Instance[]>`, `getOverview(): Promise<OverviewData>`, `deleteTeamsByPrefix(prefix: string): Promise<void>`, `deleteUsersByPrefix(prefix: string): Promise<void>`, `deleteInstancesByPrefix(prefix: string): Promise<void>`, `type OverviewData = { total_instances: number; active_instances: number; global_stats: { routes: number; services: number; upstreams: number } }`.
  - `admin.ts` (`adminPom`): `toUsers/toTeams/toInstances/toOverview(page)`, `isUsersPage/isTeamsPage/isInstancesPage/isOverviewPage(page)`, `rowByText(page, text)`, `headerInstanceSelect(page)`.

- [ ] **Step 1: Write `e2e/utils/admin-api.ts`**

```ts
/* ASF-HEADER */
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
    throw new Error(`[admin-api] ${options.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
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
  } catch {
    // already gone — cleanup must be idempotent
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
```

- [ ] **Step 2: Write `e2e/pom/admin.ts`**

```ts
/* ASF-HEADER */
import { uiGoto } from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

const locator = {
  rowByText: (page: Page, text: string) =>
    page.getByRole('row').filter({ hasText: text }),
  // Same header Select the permission POM targets (placeholder or searchbox).
  headerInstanceSelect: (page: Page) =>
    page
      .locator('header')
      .getByPlaceholder('Select instance')
      .or(page.locator('header').getByRole('searchbox'))
      .first(),
};

const assert = {
  isTeamsPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/teams'));
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
  },
  isInstancesPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/instances'));
    await expect(page.getByRole('heading', { name: 'Instances' })).toBeVisible();
  },
  isUsersPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/users'));
    await expect(
      page.getByRole('heading', { name: 'User Management' })
    ).toBeVisible();
  },
  isOverviewPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/overview'));
    await expect(
      page.getByRole('heading', { name: 'Dashboard Overview' })
    ).toBeVisible();
  },
};

const goto = {
  toTeams: (page: Page) => uiGoto(page, '/teams'),
  toInstances: (page: Page) => uiGoto(page, '/instances'),
  toUsers: (page: Page) => uiGoto(page, '/users'),
  toOverview: (page: Page) => uiGoto(page, '/overview'),
};

export const adminPom = {
  ...locator,
  ...assert,
  ...goto,
};
```

- [ ] **Step 3: Write `e2e/tests/teams.admin.spec.ts`**

Tests must not depend on each other (`fullyParallel` may run them in any order/worker), so the delete test seeds its own team via API.

```ts
/* ASF-HEADER */
import { adminPom } from '@e2e/pom/admin';
import { adminToken, deleteTeamsByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureTeam } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { expect } from '@playwright/test';

const PREFIX = randomId('adm-team');

test.afterAll(async () => {
  await deleteTeamsByPrefix(PREFIX);
});

test('creates a team via the Add Team modal', async ({ page }) => {
  const teamName = `${PREFIX}-created`;
  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);

  await page.getByRole('button', { name: 'Add Team' }).click();
  await expect(page.getByText('Add New Team')).toBeVisible();
  await page.getByLabel('Team Name').fill(teamName);
  await page.getByLabel('Description').fill('created by teams.admin e2e');
  await page.getByRole('button', { name: 'Create Team' }).click();

  await uiHasToastMsg(page, { hasText: 'Team created successfully' });
  await expect(adminPom.rowByText(page, teamName)).toBeVisible();
});

test('deletes a team from the table', async ({ page }) => {
  const teamName = `${PREFIX}-to-delete`;
  await ensureTeam(await adminToken(), { name: teamName });

  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);
  const row = adminPom.rowByText(page, teamName);
  await expect(row).toBeVisible();

  // Teams page uses native confirm() for deletion.
  page.on('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();

  await uiHasToastMsg(page, { hasText: 'Team deleted successfully' });
  await expect(adminPom.rowByText(page, teamName)).toHaveCount(0);
});

test('rejects creating a team with an empty name', async ({ page }) => {
  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);

  await page.getByRole('button', { name: 'Add Team' }).click();
  await expect(page.getByText('Add New Team')).toBeVisible();
  // Name left empty on purpose.
  await page.getByRole('button', { name: 'Create Team' }).click();

  await uiHasToastMsg(page, { hasText: 'Team name is required' });
  // The modal stays open — nothing was created.
  await expect(page.getByText('Add New Team')).toBeVisible();
});
```

- [ ] **Step 4: Run the spec — expect the empty-name test to FAIL**

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/teams.admin.spec.ts`
Expected: 2 pass, `rejects creating a team with an empty name` FAILS — the current page has no client-side validation and the backend accepts empty names (`api/internal/services/team.go:37-43` PutJSONs whatever it gets), so a nameless team is created and the expected toast never appears.

- [ ] **Step 5: Add the empty-name guard to the Teams page**

In `src/routes/teams/index.tsx`, at the top of `handleSubmit` (line 85):

```ts
  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      notifications.show({
        title: 'Error',
        message: 'Team name is required',
        color: 'red',
      });
      return;
    }
    try {
      await teamApi.create(formData);
```

(The rest of `handleSubmit` is unchanged. `notifications` is already imported on this page.)

- [ ] **Step 6: Re-run the spec — all 3 pass**

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/teams.admin.spec.ts`
Expected: `3 passed`

- [ ] **Step 7: Lint**

Run: `pnpm exec eslint e2e/utils/admin-api.ts e2e/pom/admin.ts e2e/tests/teams.admin.spec.ts src/routes/teams/index.tsx --max-warnings=0`
Expected: clean (run `pnpm lint:fix` on the files first if headers/import-order complain).

- [ ] **Step 8: Commit (two commits — fix, then test)**

```bash
git add src/routes/teams/index.tsx
git commit -m "fix(team): require a name when creating a team

The Teams page submitted whatever was in the form and the backend
persists teams without validating the name, so clicking Create with an
empty form silently created a nameless team. Guard in the UI and show
an error notification instead."

git add e2e/utils/admin-api.ts e2e/pom/admin.ts e2e/tests/teams.admin.spec.ts
git commit -m "test(team): cover the Teams admin page

The Teams page had no UI e2e coverage (multi-instance.spec.ts tests the
backend API only). Covers create via modal, delete via the table's
confirm() flow, and the new empty-name rejection. Also adds the shared
admin-api helper (backend /api/v1 list/delete/overview access) and the
adminPom used by the upcoming instances/users/overview specs."
```

---

### Task 2: Instances spec (+ aria-labels on row actions)

**Files:**
- Create: `e2e/tests/instances.admin.spec.ts`
- Modify: `src/routes/instances/index.tsx:297-317` (add `aria-label` to the three row ActionIcons)

**Interfaces:**
- Consumes: `adminPom` and `admin-api` from Task 1; `ensureInstance(token, { name, admin_api_url, admin_key, ... })` from `seed-client.ts`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `e2e/tests/instances.admin.spec.ts`**

The Staging APISIX admin API (`http://127.0.0.1:9181`, key `edd1c9f034335f136f87ad84b625c8f1` from `e2e/server/apisix_conf_2.yml`) serves as the reachable target; `http://127.0.0.1:1` as the unreachable one.

```ts
/* ASF-HEADER */
import { adminPom } from '@e2e/pom/admin';
import { adminToken, deleteInstancesByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureInstance } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { expect } from '@playwright/test';

const PREFIX = randomId('adm-inst');
// Real second APISIX from e2e/server/docker-compose.yml; key from apisix_conf_2.yml.
const STAGING_ADMIN_URL = 'http://127.0.0.1:9181';
const STAGING_ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';

test.afterAll(async () => {
  await deleteInstancesByPrefix(PREFIX);
});

test('creates an instance via the Add Instance modal', async ({ page }) => {
  const name = `${PREFIX}-created`;
  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await page.getByRole('button', { name: 'Add Instance' }).click();
  await expect(page.getByText('Add New Instance')).toBeVisible();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('created by instances.admin e2e');
  await page.getByLabel('Admin API URL').fill(STAGING_ADMIN_URL);
  await page.getByLabel('Admin Key').fill(STAGING_ADMIN_KEY);
  await page.getByRole('button', { name: 'Create Instance' }).click();

  await expect(adminPom.rowByText(page, name)).toBeVisible();
});

test('Test Connection succeeds against a reachable instance', async ({ page }) => {
  const name = `${PREFIX}-reachable`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: STAGING_ADMIN_URL,
    admin_key: STAGING_ADMIN_KEY,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);
  await adminPom
    .rowByText(page, name)
    .getByRole('button', { name: 'Test Connection' })
    .click();

  await uiHasToastMsg(page, { hasText: 'Connection Successful' });
});

test('Test Connection fails against an unreachable instance', async ({ page }) => {
  const name = `${PREFIX}-unreachable`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: 'http://127.0.0.1:1',
    admin_key: 'irrelevant',
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);
  await adminPom
    .rowByText(page, name)
    .getByRole('button', { name: 'Test Connection' })
    .click();

  await uiHasToastMsg(page, { hasText: 'Connection Failed' });
});

test('edits and deletes an instance', async ({ page }) => {
  const name = `${PREFIX}-lifecycle`;
  const renamed = `${name}-renamed`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: STAGING_ADMIN_URL,
    admin_key: STAGING_ADMIN_KEY,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await adminPom.rowByText(page, name).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText('Edit Instance')).toBeVisible();
  await page.getByLabel('Name').fill(renamed);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(adminPom.rowByText(page, renamed)).toBeVisible();

  page.on('dialog', (dialog) => void dialog.accept());
  await adminPom
    .rowByText(page, renamed)
    .getByRole('button', { name: 'Delete' })
    .click();
  await uiHasToastMsg(page, { hasText: 'Instance deleted successfully' });
  await expect(adminPom.rowByText(page, renamed)).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec — expect action-button lookups to FAIL**

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/instances.admin.spec.ts`
Expected: the create test passes; the other three FAIL at `getByRole('button', { name: 'Test Connection' | 'Edit' | 'Delete' })` — the row actions are icon-only `ActionIcon`s wrapped in `Tooltip`s, which gives them no accessible name.

- [ ] **Step 3: Add aria-labels to the three ActionIcons**

In `src/routes/instances/index.tsx` (lines 297–317), add an `aria-label` matching each Tooltip label:

```tsx
                      <Tooltip label="Test Connection">
                        <ActionIcon
                          variant="light"
                          color="blue"
                          aria-label="Test Connection"
                          onClick={() => handleTestConnection(instance.id)}
                          loading={testingId === instance.id}
                        >
                          <IconPlugConnected width="18" height="18" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit">
                        <ActionIcon variant="light" color="yellow" aria-label="Edit" onClick={() => openEditModal(instance)}>
                          <IconEdit width="18" height="18" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <ActionIcon variant="light" color="red" aria-label="Delete" onClick={() => handleDelete(instance.id)}>
                          <IconTrash width="18" height="18" />
                        </ActionIcon>
                      </Tooltip>
```

(Keep the existing icon children exactly as they are — only the `aria-label` props are new. Check the actual delete icon component name in the file before editing; the snippet shows the pattern.)

- [ ] **Step 4: Re-run the spec — all 4 pass**

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/instances.admin.spec.ts`
Expected: `4 passed`

- [ ] **Step 5: Lint**

Run: `pnpm exec eslint e2e/tests/instances.admin.spec.ts src/routes/instances/index.tsx --max-warnings=0`
Expected: clean.

- [ ] **Step 6: Commit (fix, then test)**

```bash
git add src/routes/instances/index.tsx
git commit -m "fix(instance): add aria-labels to instance row actions

The Test Connection / Edit / Delete row actions are icon-only
ActionIcons inside Tooltips, so they expose no accessible name to
screen readers (and are untargetable by accessible-role queries).
Mirror each Tooltip label as an aria-label."

git add e2e/tests/instances.admin.spec.ts
git commit -m "test(instance): cover the Instances admin page

The Instances page had no UI e2e coverage. Covers create via modal,
Test Connection against a reachable gateway (the second APISIX from the
e2e stack) and an unreachable one, and the edit + confirm()-delete
lifecycle."
```

---

### Task 3: Users spec (role assignment verified via real login)

**Files:**
- Create: `e2e/tests/users.admin.spec.ts`

**Interfaces:**
- Consumes: `adminPom`, `admin-api` (Task 1); `permission.loginAs(page, username, password)` from `e2e/pom/permission.ts`; `routesPom.getAddRouteBtn(page)` / `routesPom.toIndex(page)` / `routesPom.isIndexPage(page)` from `e2e/pom/routes.ts`; `ensureTeam`, `ensureUser`, `ensureUserInstanceRole` from `seed-client.ts`; `getFixtures()` from `e2e/utils/fixtures.ts` (for `localInstanceId`).
- Produces: nothing consumed by later tasks.

Key backend facts encoded below: non-super-admin users are created with `role: ''`; `ensureUserInstanceRole` requires a non-empty `team_id` for `developer`/`viewer`; `GET /api/v1/instances` returns only assigned instances for non-admins, so the header Select of a one-instance user offers exactly one option.

- [ ] **Step 1: Write `e2e/tests/users.admin.spec.ts`**

```ts
/* ASF-HEADER */
import { adminPom } from '@e2e/pom/admin';
import { permission } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import {
  adminToken,
  deleteTeamsByPrefix,
  deleteUsersByPrefix,
} from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { env } from '@e2e/utils/env';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

const PREFIX = randomId('adm-user');
const PASSWORD = 'e2e-Adm1n-pages!';
let teamName: string;
let teamId: string;

test.beforeAll(async () => {
  teamName = `${PREFIX}-team`;
  const team = await ensureTeam(await adminToken(), { name: teamName });
  teamId = team.id;
});

test.afterAll(async () => {
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

// The per-instance assignment card for Local APISIX inside the
// "Edit User & Permissions" modal.
const localInstanceCard = (page: Page) =>
  page
    .getByRole('dialog')
    .locator('.mantine-Paper-root')
    .filter({ hasText: 'Local APISIX' })
    .first();

test('creates a user via the Add User modal', async ({ page }) => {
  const username = `${PREFIX}-created`;
  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);

  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText('Add New User')).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  // Global Role defaults to "User (Assign per-instance roles below)".
  await page.getByRole('button', { name: 'Create User' }).click();

  await expect(adminPom.rowByText(page, username)).toBeVisible();
});

test('assigns a per-instance viewer role through the Permissions modal', async ({
  page,
}) => {
  const username = `${PREFIX}-assign`;
  await ensureUser(await adminToken(), { username, password: PASSWORD });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  await adminPom
    .rowByText(page, username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();

  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const card = localInstanceCard(page);
  await card.getByLabel('Role').click();
  await page.getByRole('option', { name: 'Viewer', exact: true }).click();
  await card.getByLabel('Team').click();
  await page.getByRole('option', { name: teamName }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();

  // The users table row now shows the assignment.
  const row = adminPom.rowByText(page, username);
  await expect(row.getByText('Local APISIX')).toBeVisible();
  await expect(row.getByText('(viewer)')).toBeVisible();
});

test('a viewer assignment takes effect: one instance, no create button', async ({
  page,
}) => {
  const username = `${PREFIX}-effect`;
  const fx = getFixtures();
  const token = await adminToken();
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, fx.localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  await permission.loginAs(page, username, PASSWORD);

  // Only the assigned instance is offered.
  const select = adminPom.headerInstanceSelect(page);
  await expect(select).toHaveValue('Local APISIX');
  await select.click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Viewer write-gating: the routes page has no Create button
  // (ToAddPageBtn renders null when canCreate is false).
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await expect(routesPom.getAddRouteBtn(page)).toHaveCount(0);
});

test('upgrading the role to instance admin restores write access', async ({
  page,
}) => {
  const username = `${PREFIX}-upgrade`;
  const fx = getFixtures();
  const token = await adminToken();
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, fx.localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  // Upgrade via the UI as admin.
  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  await adminPom
    .rowByText(page, username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const card = localInstanceCard(page);
  await card.getByLabel('Role').click();
  await page.getByRole('option', { name: 'Instance Admin', exact: true }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    adminPom.rowByText(page, username).getByText('(instance admin)')
  ).toBeVisible();

  // The upgrade is effective for the user.
  await permission.loginAs(page, username, PASSWORD);
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await expect(routesPom.getAddRouteBtn(page)).toBeVisible();
});

test('a deleted user can no longer log in', async ({ page }) => {
  const username = `${PREFIX}-deleted`;
  await ensureUser(await adminToken(), { username, password: PASSWORD });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  const row = adminPom.rowByText(page, username);
  await expect(row).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(adminPom.rowByText(page, username)).toHaveCount(0);

  // A login attempt with the deleted credentials stays on /login
  // (same assertion pattern as auth.spec.ts's invalid-credentials test).
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${env.E2E_TARGET_URL}login`);
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Run the spec**

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/users.admin.spec.ts`
Expected: `5 passed`. Debug notes if not:
- Mantine Select options render in a portal — always query `page.getByRole('option')`, never scope option queries to the card.
- If `getByLabel('Role')` matches more than one element, the card filter isn't narrow enough; `.first()` on the card handles the Local/Staging pair, but a concurrently created instance from `instances.admin.spec.ts` can add cards — the `filter({ hasText: 'Local APISIX' })` keeps the match unique regardless.
- If the header select assertion flakes right after login, the app may still be auto-selecting; `toHaveValue` auto-retries, so prefer bumping its timeout over adding waits.

- [ ] **Step 3: Lint**

Run: `pnpm exec eslint e2e/tests/users.admin.spec.ts --max-warnings=0`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/users.admin.spec.ts
git commit -m "test(user): cover the Users admin page and role-assignment flow

The Users page had no UI e2e coverage and nothing verified that a
per-instance role assignment made in the UI actually constrains what
that user sees. Covers create via modal, assigning a viewer role
through the Permissions modal, a real login as the assigned user
(single instance offered, no Create button on routes), the
viewer-to-instance-admin upgrade restoring write access, and login
rejection after deletion."
```

---

### Task 4: Overview spec

**Files:**
- Create: `e2e/tests/overview.spec.ts`

**Interfaces:**
- Consumes: `adminPom`, `getOverview` (Task 1); `e2eReq` from `e2e/utils/req.ts` and `API_ROUTES` from `@/config/constant` for seeding a route; `randomId`.
- Produces: nothing.

Flake-control reminder (see Global Constraints): the backend caches overview data for 30 s and sibling specs mutate instances/routes concurrently, so assertions are structural + `>=`, and the route-count check polls the API until the cache refresh includes the seeded route.

- [ ] **Step 1: Write `e2e/tests/overview.spec.ts`**

```ts
/* ASF-HEADER */
import { adminPom } from '@e2e/pom/admin';
import { getOverview } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

import { API_ROUTES } from '@/config/constant';

test('gateway health widget shows live instance counts', async ({ page }) => {
  await adminPom.toOverview(page);
  await adminPom.isOverviewPage(page);

  // The RingProgress label renders "<active>/<total>" above "Online".
  const counts = page.getByText(/^\d+\/\d+$/);
  await expect(counts).toBeVisible();
  await expect(page.getByText('Online', { exact: true })).toBeVisible();

  const [active, total] = (await counts.textContent())!.split('/').map(Number);
  expect(active).toBeLessThanOrEqual(total);
  // The e2e stack always has the two seeded gateways.
  expect(total).toBeGreaterThanOrEqual(2);

  // Both seeded gateways appear in the connectivity table.
  await expect(adminPom.rowByText(page, 'Local APISIX')).toBeVisible();
  await expect(adminPom.rowByText(page, 'Staging APISIX')).toBeVisible();
});

test('resource matrix reflects a route created via the API', async ({ page }) => {
  const routeName = randomId('adm-overview-probe');
  const created = await e2eReq.post<
    unknown,
    { data: { value: { id: string } } }
  >(API_ROUTES, {
    name: routeName,
    uri: `/${routeName}`,
    upstream: { type: 'roundrobin', nodes: { 'example.com:80': 1 } },
  });

  try {
    // The backend caches overview data for 30s; poll until the refresh
    // has aggregated at least our route.
    await expect
      .poll(async () => (await getOverview()).global_stats.routes, {
        timeout: 45000,
        intervals: [2000],
      })
      .toBeGreaterThanOrEqual(1);

    await adminPom.toOverview(page);
    await adminPom.isOverviewPage(page);
    await expect(page.getByText('Total Routes')).toBeVisible();

    // The stat next to "Total Routes" is a non-zero number.
    const stat = page
      .locator('div')
      .filter({ has: page.getByText('Total Routes') })
      .getByRole('heading', { level: 2 })
      .first();
    await expect(stat).toHaveText(/^\d+$/);
    expect(Number(await stat.textContent())).toBeGreaterThanOrEqual(1);
  } finally {
    await e2eReq.delete(`${API_ROUTES}/${created.data.value.id}`);
  }
});
```

- [ ] **Step 2: Run the spec**

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/overview.spec.ts`
Expected: `2 passed`. If the matrix stat locator matches multiple headings, tighten it by scoping to the `SimpleGrid` box: the "Total Routes" label and its `<Title order={2}>` share the same `Box` parent (`src/routes/overview/index.tsx:191-197`).

- [ ] **Step 3: Lint**

Run: `pnpm exec eslint e2e/tests/overview.spec.ts --max-warnings=0`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/overview.spec.ts
git commit -m "test(overview): cover the Overview dashboard page

The Overview page had a single API-level count assertion and no UI
coverage. Verifies the gateway-health widget renders live
active/total counts with both seeded gateways in the connectivity
table, and that the resource matrix aggregates a route created through
the API (polling past the backend's 30s overview cache)."
```

---

### Final verification (after all tasks)

- [ ] Run the four new specs together plus the neighbors they share state with:

Run: `E2E_TARGET_URL=http://127.0.0.1:5173/ui/ pnpm e2e e2e/tests/teams.admin.spec.ts e2e/tests/instances.admin.spec.ts e2e/tests/users.admin.spec.ts e2e/tests/overview.spec.ts e2e/tests/multi-instance.spec.ts e2e/tests/routes.ownership.spec.ts`
Expected: all pass — proves the new specs don't disturb the seeded fixtures other suites rely on.

- [ ] Run `pnpm lint --max-warnings=0` and `pnpm exec tsc -b`
Expected: both clean.
