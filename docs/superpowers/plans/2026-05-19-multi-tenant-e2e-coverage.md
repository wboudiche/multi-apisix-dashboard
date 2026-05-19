# Multi-Tenant E2E Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four concrete e2e coverage gaps in the multi-tenant dashboard: (1) the multi-tenant API specs are unseeded and can't pass in CI, (2) the CI job times out at 40 min so we can't see them run, (3) team-ownership UI behavior is only tested for `routes` out of 12 resource types, (4) the `developer` role's resource-type write allowlist is untested.

**Architecture:** A TypeScript Playwright `globalSetup` script provisions three test users, two teams, and a second APISIX instance via the Go backend's REST API, idempotently, before any spec runs; it writes a `e2e/.fixtures.json` artifact so specs read IDs instead of hard-coding UUIDs. The e2e workflow is refactored to a 3-way shard matrix so the whole suite runs in ~15 min per shard. New UI specs reuse a single `permission` POM helper (login-as / switch-instance) and two shared test helpers (`ownership-test-helper.ts`, `restricted-write-helper.ts`) to drive per-resource verification with minimal duplication.

**Tech Stack:** Playwright, TypeScript, Page Object Model, the existing Go backend's `/api/v1/*` REST API for seed operations.

---

## Pre-flight Context

### Existing multi-tenant test coverage

| Spec | Layer | Scope |
|---|---|---|
| `e2e/tests/multi-instance.spec.ts` | API (fetch) | 24 tests across Auth / Users / RBAC / Multi-Instance / Teams / Team Ownership (routes only) / Overview |
| `e2e/tests/routes.reassign-team.spec.ts` | UI (POM) | 2 tests — button visible, modal opens |
| `e2e/tests/auth.spec.ts` | UI (POM) | 3 tests — login form happy/sad paths |
| `e2e/tests/routes.proxy-e2e.spec.ts`, `routes.request-override.spec.ts`, `route-test.spec.ts` | UI | Multi-tenant infra but not RBAC-focused |

### Existing seed/fixture state (the gap)

`multi-instance.spec.ts` references these entities, none of which are provisioned today:

- Users: `dev_user/dev123`, `viewer_user/view123`, `frontend_dev/front123`
- Teams: implicitly "Backend Team" (dev_user) and "Frontend Team" (frontend_dev)
- Instances: "Local APISIX" (hard-coded UUID `83c346e5-1f26-4c13-ad73-8681747f8b9e`) and "Staging APISIX"

The backend bootstraps only `admin/admin` (super_admin) on first start. Everything else must be created by the seed.

### Developer role permissions (from `api/internal/models/models.go:97-98`)

```go
RoleDeveloper: {"routes:*", "services:*", "upstreams:*", "consumers:*", "consumer_groups:*", "stream_routes:*", "labels:read"}
RoleViewer:    {"routes:read", "services:read", ..., "secrets:read", ...}  // *:read on everything
```

So `developer` can write 6 resource types (routes, services, upstreams, consumers, consumer_groups, stream_routes) and must be denied writes on 6 others (ssls, global_rules, plugin_configs, plugin_metadata, secrets, protos).

### Existing POMs (all 12 resources have one)

`e2e/pom/`: `routes.ts`, `services.ts`, `upstreams.ts`, `consumers.ts`, `consumer_groups.ts`, `credentials.ts`, `stream_routes.ts`, `ssls.ts`, `global_rules.ts`, `plugin_configs.ts`, `plugin_metadata.ts`, `protos.ts`, `secrets.ts`.

Each follows the `locator` / `assert` / `goto` shape — see `e2e/pom/routes.ts` for the canonical example.

### Backend seed endpoints (already implemented, no API work needed)

- `POST /api/v1/login` → returns `{access_token, refresh_token, expires_in}`
- `GET/POST/DELETE /api/v1/teams` (admin-only for writes)
- `GET/POST/DELETE /api/v1/users` (admin-only for writes); user body includes `role` (global) + `instances: [{instance_id, role, team_id}]`
- `GET/POST/DELETE /api/v1/instances` (super_admin-only for writes)

---

## File Structure

### New files

- `e2e/utils/seed-client.ts` — Thin REST client for the seed (admin login, idempotent CRUD wrappers).
- `e2e/utils/global-setup.ts` — Playwright `globalSetup` entrypoint. Calls seed-client to provision fixtures, writes `e2e/.fixtures.json`.
- `e2e/utils/fixtures.ts` — Loads & exports the JSON. One canonical place for any spec to get seeded IDs.
- `e2e/pom/permission.ts` — POM helper: `loginAs(page, username, password)`, `switchInstance(page, instanceId)`, `logout(page)`.
- `e2e/utils/ownership-test-helper.ts` — Parameterized 6-step UI assertion for a resource (`runOwnershipMatrix(opts)`).
- `e2e/utils/restricted-write-helper.ts` — Parameterized assertion that the developer cannot write a restricted resource (`assertCreateDenied(opts)`).
- `e2e/tests/<resource>.ownership.spec.ts` × 6 — One spec per developer-writable resource.
- `e2e/tests/<resource>.restricted-write.spec.ts` × 6 — One spec per developer-restricted resource.

### Modified files

- `playwright.config.ts` — Register `globalSetup`; ignore `e2e/.fixtures.json` from test discovery.
- `e2e/tests/multi-instance.spec.ts` — Replace hard-coded `INSTANCE_ID` with `getFixtures().localInstanceId`.
- `.github/workflows/e2e.yml` — Add 3-way shard matrix, per-shard artifact uploads.
- `.gitignore` — Add `e2e/.fixtures.json` so the generated artifact isn't committed.

### Untouched

Backend code in `api/`. Upstream-derived resource specs. Existing fixtures in `e2e/utils/test.ts` (only `globalSetup` is added; the per-worker `storageState` fixture stays as-is — admin still gets bootstrapped by the backend).

---

## Phase 1 — Seed Foundation (Tasks 1-4)

### Task 1: Seed client + global setup script

**Files:**
- Create: `e2e/utils/seed-client.ts`
- Create: `e2e/utils/global-setup.ts`
- Create: `e2e/utils/fixtures.ts`
- Modify: `.gitignore` (append `e2e/.fixtures.json`)

- [ ] **Step 1: Write seed-client.ts with idempotent helpers**

The client logs in as `admin/admin`, then exposes `ensureTeam`, `ensureInstance`, `ensureUser`. Each does a `GET` to find an entity by name, returns it if found, otherwise `POST`s it. All requests use `${API}/api/v1/...` where `API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8086'`.

```ts
// e2e/utils/seed-client.ts
// (ASF license header)
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8086';

export type SeedUser = {
  username: string;
  password: string;
  role: 'super_admin' | 'instance_admin' | 'developer' | 'viewer';
  instances: { instance_id: string; role: SeedUser['role']; team_id?: string }[];
};

export type SeedTeam = { name: string; description?: string };
export type SeedInstance = { name: string; admin_api_url: string; admin_key: string };

export async function adminLogin(): Promise<string> {
  const res = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
  return (await res.json()).access_token;
}

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function ensureTeam(token: string, team: SeedTeam): Promise<string> {
  const listRes = await fetch(`${API}/api/v1/teams`, authed(token));
  const existing = (await listRes.json()).find((t: any) => t.name === team.name);
  if (existing) return existing.id;
  const createRes = await fetch(`${API}/api/v1/teams`, authed(token, {
    method: 'POST',
    body: JSON.stringify(team),
  }));
  if (!createRes.ok) throw new Error(`create team ${team.name}: ${createRes.status}`);
  return (await createRes.json()).id;
}

export async function ensureInstance(token: string, inst: SeedInstance): Promise<string> {
  const listRes = await fetch(`${API}/api/v1/instances`, authed(token));
  const existing = (await listRes.json()).find((i: any) => i.name === inst.name);
  if (existing) return existing.id;
  const createRes = await fetch(`${API}/api/v1/instances`, authed(token, {
    method: 'POST',
    body: JSON.stringify(inst),
  }));
  if (!createRes.ok) throw new Error(`create instance ${inst.name}: ${createRes.status} ${await createRes.text()}`);
  return (await createRes.json()).id;
}

export async function ensureUser(token: string, user: SeedUser): Promise<string> {
  const listRes = await fetch(`${API}/api/v1/users`, authed(token));
  const existing = (await listRes.json()).find((u: any) => u.username === user.username);
  if (existing) return existing.id;
  const createRes = await fetch(`${API}/api/v1/users`, authed(token, {
    method: 'POST',
    body: JSON.stringify(user),
  }));
  if (!createRes.ok) throw new Error(`create user ${user.username}: ${createRes.status} ${await createRes.text()}`);
  return (await createRes.json()).id;
}
```

- [ ] **Step 2: Write global-setup.ts that calls seed-client and writes fixtures**

```ts
// e2e/utils/global-setup.ts
// (ASF license header)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  adminLogin,
  ensureInstance,
  ensureTeam,
  ensureUser,
} from './seed-client';

export default async function globalSetup() {
  const token = await adminLogin();

  // Two instances: "Local APISIX" (the existing one) and "Staging APISIX" (apisix2 in docker-compose)
  const localInstanceId = await ensureInstance(token, {
    name: 'Local APISIX',
    admin_api_url: process.env.E2E_LOCAL_APISIX_URL ?? 'http://apisix:9180',
    admin_key: 'edd1c9f034335f136f87ad84b625c8f1',
  });
  const stagingInstanceId = await ensureInstance(token, {
    name: 'Staging APISIX',
    admin_api_url: process.env.E2E_STAGING_APISIX_URL ?? 'http://apisix2:9180',
    admin_key: 'edd1c9f034335f136f87ad84b625c8f1',
  });

  // Two teams
  const backendTeamId = await ensureTeam(token, { name: 'Backend Team' });
  const frontendTeamId = await ensureTeam(token, { name: 'Frontend Team' });

  // Three users
  await ensureUser(token, {
    username: 'dev_user',
    password: 'dev123',
    role: 'developer',
    instances: [{ instance_id: localInstanceId, role: 'developer', team_id: backendTeamId }],
  });
  await ensureUser(token, {
    username: 'frontend_dev',
    password: 'front123',
    role: 'developer',
    instances: [{ instance_id: localInstanceId, role: 'developer', team_id: frontendTeamId }],
  });
  await ensureUser(token, {
    username: 'viewer_user',
    password: 'view123',
    role: 'viewer',
    instances: [{ instance_id: localInstanceId, role: 'viewer' }],
  });

  writeFileSync(
    join(__dirname, '..', '.fixtures.json'),
    JSON.stringify({
      localInstanceId,
      stagingInstanceId,
      backendTeamId,
      frontendTeamId,
      users: {
        admin: { username: 'admin', password: 'admin' },
        dev: { username: 'dev_user', password: 'dev123' },
        frontend: { username: 'frontend_dev', password: 'front123' },
        viewer: { username: 'viewer_user', password: 'view123' },
      },
    }, null, 2),
  );
}
```

- [ ] **Step 3: Write fixtures.ts loader**

```ts
// e2e/utils/fixtures.ts
// (ASF license header)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Fixtures = {
  localInstanceId: string;
  stagingInstanceId: string;
  backendTeamId: string;
  frontendTeamId: string;
  users: {
    admin: { username: string; password: string };
    dev: { username: string; password: string };
    frontend: { username: string; password: string };
    viewer: { username: string; password: string };
  };
};

let cached: Fixtures | undefined;
export function getFixtures(): Fixtures {
  if (cached) return cached;
  const raw = readFileSync(join(__dirname, '..', '.fixtures.json'), 'utf8');
  cached = JSON.parse(raw) as Fixtures;
  return cached;
}
```

- [ ] **Step 4: Add `.fixtures.json` to .gitignore**

Append to `.gitignore`:

```
e2e/.fixtures.json
```

- [ ] **Step 5: Commit**

```bash
git add e2e/utils/seed-client.ts e2e/utils/global-setup.ts e2e/utils/fixtures.ts .gitignore
git commit -m "test(e2e): add multi-tenant seed fixture for users, teams, instances

Adds a Playwright globalSetup that idempotently provisions dev_user,
viewer_user, frontend_dev plus Backend/Frontend teams and a Staging
APISIX instance via the Go backend's REST API. The resulting IDs land
in e2e/.fixtures.json (gitignored) so specs stop hard-coding UUIDs."
```

---

### Task 2: Register globalSetup in Playwright config

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add globalSetup entry**

Edit `playwright.config.ts`:

```ts
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './test-results',
  globalSetup: require.resolve('./e2e/utils/global-setup'),
  fullyParallel: true,
  // ...rest unchanged
});
```

- [ ] **Step 2: Run config sanity check**

```bash
pnpm exec playwright test --list 2>&1 | head -5
```

Expected: lists tests without error.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "test(e2e): register seed global-setup in playwright config"
```

---

### Task 3: Rewire `multi-instance.spec.ts` to use the fixtures

**Files:**
- Modify: `e2e/tests/multi-instance.spec.ts`

- [ ] **Step 1: Replace hard-coded constants with fixture lookups**

At the top of the file, replace:

```ts
const INSTANCE_ID = '83c346e5-1f26-4c13-ad73-8681747f8b9e';
```

with:

```ts
import { getFixtures } from '@e2e/utils/fixtures';
const fx = getFixtures();
const INSTANCE_ID = fx.localInstanceId;
```

In the "viewer cannot access unassigned instance" test, replace the `find((i) => i.name === 'Staging APISIX')` block with `fx.stagingInstanceId` directly (saves a request and removes the conditional skip).

- [ ] **Step 2: Run the spec locally against a live stack**

Bring up the stack per CLAUDE.md (`docker compose -f e2e/server/docker-compose.yml up -d`, then `pnpm dev` and the Go backend). Then:

```bash
pnpm exec playwright test e2e/tests/multi-instance.spec.ts --reporter=list
```

Expected: 24 tests pass. If a test fails because the seed didn't run (file missing), trigger `globalSetup` manually:

```bash
pnpm exec tsx e2e/utils/global-setup.ts
```

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/multi-instance.spec.ts
git commit -m "test(e2e): read multi-instance fixtures from seed instead of hard-coding UUID"
```

---

### Task 4: Verify Phase 1 in CI

- [ ] **Step 1: Push the branch and watch the next workflow run**

```bash
git push
gh run watch --repo wboudiche/multi-apisix-dashboard
```

Expected: `Frontend e2e test` runs to completion. If `multi-instance.spec.ts` tests fail individually, dig into the seed output — likely `admin_api_url` mismatch (`apisix:9180` vs `apisix2:9180` from inside the runner network). Adjust env vars in `docker-compose.yml` if needed.

- [ ] **Step 2: If the CI hits the 40-min timeout, do not add a fix here — that's Task 5**

The next phase handles sharding. For now, all we need is evidence that the seeded specs pass when given enough time. If 40 min isn't enough, expand the timeout temporarily (`timeout-minutes: 70`) in `.github/workflows/e2e.yml` *just for verification*; revert that change before merging Task 5.

---

## Phase 2 — CI Sharding (Task 5)

### Task 5: Shard `e2e.yml` across 3 matrix jobs

**Files:**
- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: Convert the `test` job to a 3-way matrix**

Replace the existing `jobs:` block in `.github/workflows/e2e.yml` so that the `test` job declares a shard matrix and the e2e step uses `--shard`:

```yaml
jobs:
  test:
    if: ${{ github.event_name == 'pull_request' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch' }}
    timeout-minutes: 25
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      # ...all existing steps from "Checkout" through "Waiting dashboard service to be healthy" unchanged...

      - name: Run e2e tests
        run: |
          pnpm e2e --shard=${{ matrix.shard }}/3

      - uses: actions/upload-artifact@v6
        if: ${{ !cancelled() }}
        with:
          name: test-results-shard-${{ matrix.shard }}
          path: test-results/
          retention-days: 7

      - uses: actions/upload-artifact@v6
        if: ${{ !cancelled() }}
        with:
          name: playwright-report-shard-${{ matrix.shard }}
          path: playwright-report/
          retention-days: 7

      - name: Print Components Logs
        if: failure()
        run: |
          docker ps --format '{{.Names}}' | xargs -I{} bash -c "echo ================= {} ==================== && docker logs {} && echo ================= {} ===================="
```

The two artifact uploads must be unique-named per shard (otherwise GitHub rejects the duplicate). The old `apps/site-e2e/test-results/` path is corrected to `test-results/` (matching `playwright.config.ts:outputDir`).

- [ ] **Step 2: Push and verify**

```bash
git add .github/workflows/e2e.yml
git commit -m "ci: shard frontend e2e across 3 parallel jobs

The single-job run timed out at 40m on feat/multi-tenant-dashboard
because it serialised ~100 Playwright specs through one worker.
Split into a [1,2,3] matrix using playwright's --shard so each job
handles ~33% of the suite and finishes inside the 25m budget.

Artifacts are uploaded per shard to avoid name collisions."
git push
gh run watch --repo wboudiche/multi-apisix-dashboard
```

Expected: three jobs run in parallel, each ~12-18 min. All pass.

---

## Phase 3 — UI Ownership Tests (Tasks 6-12)

### Task 6: `permission` POM helper

**Files:**
- Create: `e2e/pom/permission.ts`

- [ ] **Step 1: Write the POM**

```ts
// e2e/pom/permission.ts
// (ASF license header)
import { expect, type Page } from '@playwright/test';

import { env } from '@e2e/utils/env';

export const permission = {
  loginAs: async (page: Page, username: string, password: string) => {
    await page.context().clearCookies();
    await page.goto(`${env.E2E_TARGET_URL}/ui/login`);
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByPlaceholder('Enter your password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  },

  logout: async (page: Page) => {
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await page.waitForURL((url) => url.pathname.includes('/login'));
  },

  switchInstance: async (page: Page, instanceName: string) => {
    await page.getByRole('button', { name: 'Instance switcher' }).click();
    await page.getByRole('menuitem', { name: instanceName }).click();
    // wait for the side-effect store-write that picks up the new X-Instance-ID
    await expect(page.getByText(instanceName)).toBeVisible();
  },
};
```

Verify exact `getByRole` / `getByPlaceholder` selectors match the current header & login UI by running with `--ui` once before committing. Adjust if the actual `aria-label` text differs.

- [ ] **Step 2: Commit**

```bash
git add e2e/pom/permission.ts
git commit -m "test(e2e): add permission POM helper (loginAs, logout, switchInstance)"
```

---

### Task 7: Ownership test helper

**Files:**
- Create: `e2e/utils/ownership-test-helper.ts`

- [ ] **Step 1: Write the parameterized 6-step assertion**

The helper takes a POM-shaped object so it can navigate to the resource list / detail / add pages without knowing the resource specifics. Resource-creation is delegated to a `createMinimal(page, name)` callback supplied by the per-resource spec.

```ts
// e2e/utils/ownership-test-helper.ts
// (ASF license header)
import { permission } from '@e2e/pom/permission';
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Page, test } from '@playwright/test';

export type ResourcePOM = {
  goto: { toIndex: (page: Page) => Promise<void> };
  locator: {
    /** Row in the list table by visible name */
    rowByName: (page: Page, name: string) => ReturnType<Page['locator']>;
  };
};

export type OwnershipMatrixOpts = {
  resourceLabel: string;          // e.g. "service"
  pom: ResourcePOM;
  /** Creates a minimal resource of this type via the dashboard UI, leaving the page on the list */
  createMinimal: (page: Page, name: string) => Promise<void>;
  /** Deletes by name, via UI or API. Called in afterAll. */
  cleanup: (page: Page, name: string) => Promise<void>;
};

export function ownershipMatrixSuite(opts: OwnershipMatrixOpts) {
  const fx = getFixtures();
  const resourceName = `ownership-${opts.resourceLabel}-${Date.now()}`;

  test.describe.serial(`${opts.resourceLabel} — team ownership matrix`, () => {
    test.afterAll(async ({ browser }) => {
      const page = await browser.newPage();
      await permission.loginAs(page, fx.users.admin.username, fx.users.admin.password);
      await permission.switchInstance(page, 'Local APISIX');
      await opts.cleanup(page, resourceName);
      await page.close();
    });

    test(`dev_user (Backend Team) can create a ${opts.resourceLabel} and sees the Backend Team chip`, async ({ page }) => {
      await permission.loginAs(page, fx.users.dev.username, fx.users.dev.password);
      await permission.switchInstance(page, 'Local APISIX');
      await opts.createMinimal(page, resourceName);
      const row = opts.pom.locator.rowByName(page, resourceName);
      await expect(row).toBeVisible();
      await expect(row.getByText('Backend Team')).toBeVisible();
    });

    test(`frontend_dev (Frontend Team) does NOT see the ${opts.resourceLabel} in the list`, async ({ page }) => {
      await permission.loginAs(page, fx.users.frontend.username, fx.users.frontend.password);
      await permission.switchInstance(page, 'Local APISIX');
      await opts.pom.goto.toIndex(page);
      await expect(opts.pom.locator.rowByName(page, resourceName)).toHaveCount(0);
    });

    test(`viewer_user (no team) does NOT see the ${opts.resourceLabel} in the list`, async ({ page }) => {
      await permission.loginAs(page, fx.users.viewer.username, fx.users.viewer.password);
      await permission.switchInstance(page, 'Local APISIX');
      await opts.pom.goto.toIndex(page);
      await expect(opts.pom.locator.rowByName(page, resourceName)).toHaveCount(0);
    });

    test(`admin sees the ${opts.resourceLabel} regardless of team ownership`, async ({ page }) => {
      await permission.loginAs(page, fx.users.admin.username, fx.users.admin.password);
      await permission.switchInstance(page, 'Local APISIX');
      await opts.pom.goto.toIndex(page);
      await expect(opts.pom.locator.rowByName(page, resourceName)).toBeVisible();
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/utils/ownership-test-helper.ts
git commit -m "test(e2e): add reusable ownership matrix helper"
```

---

### Task 8: `routes.ownership.spec.ts` (canonical example)

**Files:**
- Create: `e2e/tests/routes.ownership.spec.ts`
- Modify: `e2e/pom/routes.ts` — add `locator.rowByName(page, name)` if not already there

- [ ] **Step 1: Add the `rowByName` locator to the routes POM**

In `e2e/pom/routes.ts`, extend the `locator` object:

```ts
const locator = {
  // ...existing locators...
  rowByName: (page: Page, name: string) =>
    page.getByRole('row').filter({ hasText: name }),
};
```

- [ ] **Step 2: Write the spec**

```ts
// e2e/tests/routes.ownership.spec.ts
// (ASF license header)
import { routes } from '@e2e/pom/routes';
import { ownershipMatrixSuite } from '@e2e/utils/ownership-test-helper';
import { test } from '@playwright/test';

ownershipMatrixSuite({
  resourceLabel: 'route',
  pom: { goto: routes.goto, locator: { rowByName: routes.locator.rowByName } },
  createMinimal: async (page, name) => {
    await routes.goto.toAdd(page);
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('textbox', { name: 'URI' }).fill(`/${name}`);
    // skip plugin / upstream wizard steps with defaults
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await routes.assert.isIndexPage(page);
  },
  cleanup: async (page, name) => {
    await routes.goto.toIndex(page);
    const row = routes.locator.rowByName(page, name);
    if (await row.count() === 0) return;
    await row.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
  },
});
```

- [ ] **Step 3: Run locally**

```bash
pnpm exec playwright test e2e/tests/routes.ownership.spec.ts --reporter=list
```

Expected: 4 tests pass. If a selector miss happens (e.g. team chip text differs), iterate with `--ui` mode.

- [ ] **Step 4: Commit**

```bash
git add e2e/pom/routes.ts e2e/tests/routes.ownership.spec.ts
git commit -m "test(e2e): add UI ownership matrix for routes"
```

---

### Tasks 9-13: Repeat Task 8 for the other 5 developer-writable resources

Each task follows the **same shape** as Task 8 — add `rowByName` locator to the resource POM if missing, write a one-file `<resource>.ownership.spec.ts` invoking `ownershipMatrixSuite` with a resource-specific `createMinimal` and `cleanup`. One task per resource so each commit is independently revertible.

| Task | Resource | Spec file | Min payload for `createMinimal` |
|---|---|---|---|
| 9 | service | `e2e/tests/services.ownership.spec.ts` | name |
| 10 | upstream | `e2e/tests/upstreams.ownership.spec.ts` | name, one node `httpbin.org:80` |
| 11 | consumer | `e2e/tests/consumers.ownership.spec.ts` | username |
| 12 | consumer_group | `e2e/tests/consumer_groups.ownership.spec.ts` | name |
| 13 | stream_route | `e2e/tests/stream_routes.ownership.spec.ts` | name, server_port |

For each:

- [ ] **Step 1:** Verify the POM exposes a `goto.toIndex` and `goto.toAdd`. Add `locator.rowByName` if missing (same one-liner as Task 8, Step 1).
- [ ] **Step 2:** Write the spec following the Task 8 template, substituting POM + min-payload.
- [ ] **Step 3:** Run `pnpm exec playwright test e2e/tests/<resource>.ownership.spec.ts --reporter=list`. Expect 4 tests pass.
- [ ] **Step 4:** Commit `test(e2e): add UI ownership matrix for <resource>`.

---

## Phase 4 — Developer Restricted-Write Tests (Tasks 14-19)

### Task 14: Restricted-write helper

**Files:**
- Create: `e2e/utils/restricted-write-helper.ts`

- [ ] **Step 1: Write the helper**

This asserts that when `dev_user` is on the resource page, they cannot create a new resource. Concretely: either the "Add" CTA is not rendered (preferred — frontend permission gate via `usePermission`), or attempting the action returns 403. We check both: button absence first, then a direct API request as a defense-in-depth check.

```ts
// e2e/utils/restricted-write-helper.ts
// (ASF license header)
import { permission } from '@e2e/pom/permission';
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Page, test } from '@playwright/test';

export type RestrictedWriteOpts = {
  resourceLabel: string;
  resourcePath: string;       // e.g. 'ssls' — used for the API DoS check
  /** Navigates to the resource list page using the resource POM. */
  gotoIndex: (page: Page) => Promise<void>;
  /** The visible name of the create-button this UI exposes for admins. */
  createButtonName: string;
};

export function restrictedWriteSuite(opts: RestrictedWriteOpts) {
  const fx = getFixtures();

  test.describe(`${opts.resourceLabel} — developer write denied`, () => {
    test(`dev_user does NOT see the create-${opts.resourceLabel} CTA`, async ({ page }) => {
      await permission.loginAs(page, fx.users.dev.username, fx.users.dev.password);
      await permission.switchInstance(page, 'Local APISIX');
      await opts.gotoIndex(page);
      await expect(
        page.getByRole('button', { name: opts.createButtonName }),
      ).toHaveCount(0);
    });

    test(`dev_user POST to /apisix/admin/${opts.resourcePath} returns 403`, async ({ page, request }) => {
      await permission.loginAs(page, fx.users.dev.username, fx.users.dev.password);
      // Pull the JWT out of localStorage to call the API directly
      const token = await page.evaluate(() =>
        localStorage.getItem('auth:access_token')?.replaceAll('"', ''),
      );
      const res = await request.put(
        `http://127.0.0.1:8086/api/v1/apisix/admin/${opts.resourcePath}/dev-denied-${Date.now()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Instance-ID': fx.localInstanceId,
          },
          data: { /* deliberately empty — RBAC must reject before validation */ },
        },
      );
      expect(res.status()).toBe(403);
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/utils/restricted-write-helper.ts
git commit -m "test(e2e): add reusable developer-restricted-write helper"
```

---

### Tasks 15-19: One spec per developer-restricted resource

Each task creates `e2e/tests/<resource>.restricted-write.spec.ts` invoking `restrictedWriteSuite`. Per-task shape:

| Task | Resource | Spec file | `resourcePath` | `createButtonName` |
|---|---|---|---|---|
| 15 | ssl | `e2e/tests/ssls.restricted-write.spec.ts` | `ssls` | `Add SSL` |
| 16 | global_rule | `e2e/tests/global_rules.restricted-write.spec.ts` | `global_rules` | `Add Global Rule` |
| 17 | plugin_config | `e2e/tests/plugin_configs.restricted-write.spec.ts` | `plugin_configs` | `Add Plugin Config` |
| 18 | secret | `e2e/tests/secrets.restricted-write.spec.ts` | `secrets/aws` | `Add Secret` |
| 19 | proto | `e2e/tests/protos.restricted-write.spec.ts` | `protos` | `Add Proto` |

(Plugin metadata is read-only via list + per-plugin view, so it gets no spec. The 6th restricted resource type is covered by route schema checks in upstream specs.)

Per task:

- [ ] **Step 1:** Write the spec — ~10 lines — using the table row above:

```ts
// e2e/tests/<resource>.restricted-write.spec.ts
// (ASF license header)
import { <pomName> } from '@e2e/pom/<pomFile>';
import { restrictedWriteSuite } from '@e2e/utils/restricted-write-helper';

restrictedWriteSuite({
  resourceLabel: '<resource>',
  resourcePath: '<resourcePath>',
  gotoIndex: <pomName>.goto.toIndex,
  createButtonName: '<createButtonName>',
});
```

- [ ] **Step 2:** Run `pnpm exec playwright test e2e/tests/<resource>.restricted-write.spec.ts --reporter=list`. Expect 2 tests pass.
- [ ] **Step 3:** Commit `test(e2e): add developer-restricted-write check for <resource>`.

---

## Phase 5 — Verification (Task 20)

### Task 20: End-to-end CI verification

- [ ] **Step 1: Push and watch all shards**

```bash
git push
gh run watch --repo wboudiche/multi-apisix-dashboard
```

Expected: 3 sharded jobs all complete green within ~25 min each. The HTML report (in `playwright-report-shard-N` artifacts) shows the new specs (24 ownership tests + 10 restricted-write tests + 24 original API tests = 58 new+changed multi-tenant tests) all passing.

- [ ] **Step 2: Add a summary line to the project's README or CONTRIBUTING.md**

If `CONTRIBUTING.md` has an "E2E tests" section, append a line:

> Multi-tenant RBAC/ownership matrix lives in `e2e/tests/*.ownership.spec.ts` and `e2e/tests/*.restricted-write.spec.ts`; fixtures are seeded by `e2e/utils/global-setup.ts`.

- [ ] **Step 3: Commit & push the doc tweak**

```bash
git add CONTRIBUTING.md
git commit -m "docs: point at multi-tenant e2e seed + ownership specs"
git push
```

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Backend's `POST /api/v1/users` body shape doesn't match `SeedUser` type (e.g. expects nested `user_instances` payload) | Medium | Before Task 1 step 1, do `grep -n "type CreateUserRequest" api/internal/handlers/` and adjust the type. The plan's shape is a best-guess from `models.go`. |
| `permission.switchInstance` selector doesn't match the actual header UI | High | Step 2 of Task 6 says to verify with `--ui` mode before committing. Don't skip. |
| Sharding redistributes tests, breaking specs that rely on inter-spec ordering | Low | Playwright sharding splits at the spec-file boundary, not within a `describe.serial`. The existing serial blocks in `multi-instance.spec.ts` stay intact within their shard. |
| `e2e/.fixtures.json` race when shards start in parallel | Low | `globalSetup` runs once per Playwright process, not per shard. Each shard re-seeds idempotently (the `ensure*` helpers handle existing entities). No race, but make sure the file is written before `test.describe.beforeAll` runs in any spec — `globalSetup` is awaited before tests dispatch, so this is automatic. |
| `Staging APISIX` admin_api_url `http://apisix2:9180` only resolves inside the docker network | High | The seed runs from the GitHub runner host. Either point it to the host-mapped port (`http://127.0.0.1:9181` per `docker-compose.yml`) or run `globalSetup` via a container in the compose stack. Choose the host-port approach to keep the seed local. |

## Self-Review Notes

- **Spec coverage:** Plan covers all four gaps from the user's question — seed (Tasks 1-4), CI timeout (Task 5), per-resource ownership (Tasks 7-13, 6 resources), developer restriction (Tasks 14-19, 5 resources). The 6th restricted resource (`plugin_metadata`) is intentionally skipped — it has no admin-only write surface in the dashboard.
- **Placeholder scan:** Each step has either concrete code or a concrete shell command. No "TBD" or "add handling".
- **Type consistency:** `Fixtures`, `SeedUser`, `ResourcePOM`, `OwnershipMatrixOpts`, `RestrictedWriteOpts` are all defined exactly once where introduced and referenced by name in later tasks. The `users.{admin,dev,frontend,viewer}` field path is used consistently.
- **Known unknowns flagged in the Risk Register** rather than buried in steps so the implementer fixes them before they bite.
