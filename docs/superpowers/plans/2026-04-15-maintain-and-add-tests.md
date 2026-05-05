# Maintain and Add E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken E2E tests caused by our recent changes (settings removal, wizard step changes, quick templates removal) and add new tests for the features we added (Request Override, Plugin Schema Form, Reassign Team).

**Architecture:** The E2E tests use Playwright with a Page Object Model pattern in `e2e/pom/`, test utilities in `e2e/utils/`, and test files in `e2e/tests/`. Tests authenticate via a JWT login flow. The `e2e/utils/test.ts` worker fixture handles shared auth. The `e2e/utils/req.ts` provides an Axios adapter for API calls inside tests.

**Tech Stack:** Playwright, TypeScript, Page Object Model pattern, Axios (for API test helpers)

---

## Broken Tests Analysis

### Critical Breaks (will fail immediately):

1. **`e2e/utils/test.ts`** — Worker auth fixture references removed Settings modal (`getByRole('dialog', { name: 'Settings' })`, `getByLabel('Admin Key')`). This breaks ALL tests that use the shared `test` fixture.

2. **`e2e/utils/req.ts`** — Imports `API_HEADER_KEY` from `@/config/constant`, which we removed. This breaks ALL tests that use `e2eReq`.

3. **`e2e/tests/auth.spec.ts`** — Tests Settings modal, Admin Key input, password visibility toggle. Entirely obsolete.

4. **`e2e/tests/routes.add-ux.spec.ts`** — Feature 5 test expects "Quick Templates" in plugin drawer (removed). Feature 12 test expects Quick Templates click. Feature 1 Preview test has wrong step count (was 4 steps, now 5 with Request Override).

### Step Count Impact (now 5 steps instead of 4):

Tests that navigate through route wizard steps by clicking "Next" N times will land on wrong steps. The new order is:
1. Define API Information
2. Define Upstream
3. **Request Override** (NEW)
4. Plugins
5. Preview

Affected tests: `routes.add-ux.spec.ts` (Features 1, 4, 5, 12), `routes.crud-required-fields.spec.ts` (if it navigates by step), `hot-path.upstream-service-route.spec.ts`.

---

## File Structure

### Fix existing files:
- `e2e/utils/test.ts` — Replace Settings modal auth with JWT login flow
- `e2e/utils/req.ts` — Fix removed `API_HEADER_KEY` constant
- `e2e/tests/auth.spec.ts` — Replace with JWT login tests
- `e2e/tests/routes.add-ux.spec.ts` — Fix step count, remove Quick Templates tests

### New test files:
- `e2e/tests/routes.request-override.spec.ts` — Test the Request Override wizard step
- `e2e/tests/routes.plugin-form.spec.ts` — Test the schema-driven Plugin Form UI
- `e2e/tests/routes.reassign-team.spec.ts` — Test the Reassign Team feature

---

### Task 1: Fix e2e/utils/req.ts (API_HEADER_KEY removal)

**Files:**
- Modify: `e2e/utils/req.ts:21`

This file imports `API_HEADER_KEY` which we removed from `@/config/constant`. It's used to set the `X-API-KEY` header for direct APISIX Admin API calls in tests. We need to inline the constant.

- [ ] **Step 1: Fix the import**

Replace the broken import in `e2e/utils/req.ts`:

```typescript
// OLD (broken):
import { API_HEADER_KEY, API_PREFIX, BASE_PATH } from '@/config/constant';

// NEW:
import { API_PREFIX, BASE_PATH } from '@/config/constant';

const API_HEADER_KEY = 'X-API-KEY';
```

- [ ] **Step 2: Verify the fix compiles**

Run: `cd ../apisix-dashboard && npx tsc --noEmit --project e2e/tsconfig.json 2>&1 | head -20`

If there's no dedicated tsconfig for e2e, just verify the file has no syntax errors by reading it.

- [ ] **Step 3: Commit**

```bash
git add e2e/utils/req.ts
git commit -m "fix(e2e): inline API_HEADER_KEY constant removed from src"
```

---

### Task 2: Fix e2e/utils/test.ts (auth fixture)

**Files:**
- Modify: `e2e/utils/test.ts`

The worker auth fixture tries to authenticate by filling the Settings modal Admin Key input — which no longer exists. Our dashboard now uses JWT login (`/login` page with username/password). Replace the auth fixture to use the login form.

- [ ] **Step 1: Replace the auth fixture**

Replace the full content of `e2e/utils/test.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test as baseTest } from '@playwright/test';

import { fileExists } from './common';
import { env } from './env';

export type Test = typeof test;
export const test = baseTest.extend<object, { workerStorageState: string }>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),
  workerStorageState: [
    async ({ browser }, use) => {
      const id = test.info().parallelIndex;
      const fileName = path.resolve(
        test.info().project.outputDir,
        `.auth/${id}.json`
      );

      // Reuse existing auth state if available
      if (await fileExists(fileName)) {
        const content = (await readFile(fileName)).toString();
        if (content.includes('auth:access_token')) {
          return use(fileName);
        }
      }

      const page = await browser.newPage({ storageState: undefined });
      await page.goto(env.E2E_TARGET_URL);

      // Authenticate via JWT login form
      await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10000 });
      await page.getByRole('textbox', { name: 'Username' }).fill('admin');
      await page.getByPlaceholder('Enter your password').fill('admin');
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Wait for redirect away from login
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

      await page.context().storageState({ path: fileName });
      await page.close();
      await use(fileName);
    },
    { scope: 'worker' },
  ],
  page: async ({ baseURL, page }, use) => {
    await page.goto(baseURL);
    await use(page);
  },
});
```

- [ ] **Step 2: Verify the fixture works by running a simple test**

Run: `cd ../apisix-dashboard && pnpm e2e -- --grep "should CRUD route" --headed 2>&1 | tail -20`

Or if not ready for full run, just verify file has no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add e2e/utils/test.ts
git commit -m "fix(e2e): replace Settings modal auth with JWT login flow"
```

---

### Task 3: Replace auth.spec.ts with JWT login tests

**Files:**
- Modify: `e2e/tests/auth.spec.ts`

The old tests tested the Settings modal Admin Key flow. Replace with tests for the JWT login page.

- [ ] **Step 1: Replace auth.spec.ts**

```typescript
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

// Use empty storage state to start unauthenticated
test.use({ storageState: { cookies: [], origins: [] } });

test('redirects to login page when not authenticated', { tag: '@auth' }, async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(page).toHaveURL(/\/login/);
});

test('can login with valid credentials', { tag: '@auth' }, async ({ page }) => {
  await page.goto('/ui/login');

  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  await expect(page).toHaveURL(/\/overview/);
});

test('shows error with invalid credentials', { tag: '@auth' }, async ({ page }) => {
  await page.goto('/ui/login');

  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Should stay on login page
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Run the auth tests**

Run: `cd ../apisix-dashboard && pnpm e2e -- e2e/tests/auth.spec.ts 2>&1 | tail -20`

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/auth.spec.ts
git commit -m "fix(e2e): replace admin key auth tests with JWT login tests"
```

---

### Task 4: Fix routes.add-ux.spec.ts

**Files:**
- Modify: `e2e/tests/routes.add-ux.spec.ts`

Three issues to fix:
1. Remove `hideTanStackDevtools` helper (devtools removed)
2. Remove Feature 5 "Quick Templates" test (feature removed)
3. Fix step navigation — wizard now has 5 steps, not 4. Step 3 is Request Override, Step 4 is Plugins, Step 5 is Preview.

- [ ] **Step 1: Remove hideTanStackDevtools helper and its calls**

Delete the `hideTanStackDevtools` function (lines 37-43) and remove all calls to it throughout the file: in `goToAddRoute`, `clickNext`, and the Preview test.

- [ ] **Step 2: Remove Feature 5 Quick Templates test**

Delete the entire test block:
```typescript
test('Feature 5: Quick Templates appear in plugin drawer', ...);
```

- [ ] **Step 3: Fix Feature 12 Plugin count badge test**

The test tries to use Quick Templates to add a plugin. Change it to use the categorized plugin list instead:

```typescript
test('Feature 12: Plugin count badge shows on step label', async ({ page }) => {
  await goToAddRoute(page);

  await page.locator('input[name="name"]').fill('test-plugin-badge');
  await page.locator('input[name="uri"]').fill('/test-badge');

  await clickNext(page); // step 1 -> 2
  await clickNext(page); // step 2 -> 3 (Request Override)
  await clickNext(page); // step 3 -> 4 (Plugins)

  // Open plugin drawer
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  await page.waitForTimeout(1000);

  // Add a plugin from the categorized list
  const drawer = page.locator('.mantine-Drawer-body');
  await drawer.locator('button:has-text("Add")').first().click();
  await page.waitForTimeout(2000);

  // Save the plugin in the editor
  const editorDrawer = page.locator('[role="dialog"]').last();
  await editorDrawer.locator('button[data-block="true"]').click();
  await page.waitForTimeout(1000);

  // Check that the stepper's Plugins step shows a badge count "1"
  const stepperText = await page.evaluate(() => {
    const steps = document.querySelectorAll('.mantine-Stepper-step');
    return steps[3]?.textContent || ''; // Step index 3 = Plugins (0-indexed)
  });
  expect(stepperText).toContain('1');
  expect(stepperText).toContain('Plugins');
});
```

- [ ] **Step 4: Fix Feature 1 Preview step navigation**

In the Preview test, change step navigation from 3 "Next" clicks to 4:

```typescript
// Navigate through all steps to Preview (step 5)
await clickNext(page); // step 1 -> 2
await clickNext(page); // step 2 -> 3 (Request Override)
await clickNext(page); // step 3 -> 4 (Plugins)
await page.getByRole('button', { name: 'Next' }).click(); // step 4 -> 5 (Preview)
await page.waitForTimeout(3000);
```

- [ ] **Step 5: Fix Feature 4 step summary test**

The step summary test navigates to step 2. This is fine — no change needed (one "Next" click still goes 1 → 2).

- [ ] **Step 6: Commit**

```bash
git add e2e/tests/routes.add-ux.spec.ts
git commit -m "fix(e2e): update route UX tests for 5-step wizard, remove Quick Templates test"
```

---

### Task 5: New test — Request Override step

**Files:**
- Create: `e2e/tests/routes.request-override.spec.ts`

Test the new Request Override wizard step that generates `proxy-rewrite` plugin config.

- [ ] **Step 1: Create the test file**

```typescript
import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/ui';
test.setTimeout(60000);

async function login(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);
  if (page.url().includes('/login')) {
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
  }
}

async function navigateToRequestOverrideStep(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/routes/add`);
  await page.waitForTimeout(1000);

  // Step 1: Fill required fields
  await page.locator('input[name="name"]').fill('test-override');
  await page.locator('input[name="uri"]').fill('/test-override');

  // Step 1 -> 2
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);

  // Step 2: Add upstream node
  await page.locator('button:has-text("+Add a Node")').click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="Hostname or IP"]').fill('httpbin.org');
  await page.locator('input[placeholder="Port"]').fill('80');

  // Step 2 -> 3 (Request Override)
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);
}

test.describe('Route Add - Request Override Step', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Request Override step is visible in stepper', async ({ page }) => {
    await page.goto(`${BASE_URL}/routes/add`);
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Request Override')).toBeVisible();
  });

  test('Request Override shows scheme, URI, host, method, header fields', async ({ page }) => {
    await navigateToRequestOverrideStep(page);

    await expect(page.locator('text=Scheme')).toBeVisible();
    await expect(page.locator('text=URI Override')).toBeVisible();
    await expect(page.locator('text=Host Override')).toBeVisible();
    await expect(page.locator('text=Method Override')).toBeVisible();
    await expect(page.locator('text=Header Override')).toBeVisible();
    await expect(page.locator('text=Keep Original')).toBeVisible();
  });

  test('changing scheme to HTTPS generates proxy-rewrite config', async ({ page }) => {
    await navigateToRequestOverrideStep(page);

    // Select HTTPS scheme
    await page.locator('label:has-text("HTTPS")').click();
    await page.waitForTimeout(300);

    // Navigate to Plugins step to verify proxy-rewrite is added
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(1000);

    // proxy-rewrite should appear in the plugins list
    await expect(page.locator('text=proxy-rewrite')).toBeVisible();
  });

  test('static URI override generates proxy-rewrite with uri field', async ({ page }) => {
    await navigateToRequestOverrideStep(page);

    // Select Static URI mode
    await page.locator('label:has-text("Static")').first().click();
    await page.waitForTimeout(300);

    // Fill static URI
    await page.locator('input[placeholder="/new/path"]').fill('/api/v2');
    await page.waitForTimeout(300);

    // Navigate to Plugins step
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=proxy-rewrite')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd ../apisix-dashboard && pnpm e2e -- e2e/tests/routes.request-override.spec.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/routes.request-override.spec.ts
git commit -m "test(e2e): add Request Override step tests"
```

---

### Task 6: New test — Plugin Schema Form

**Files:**
- Create: `e2e/tests/routes.plugin-form.spec.ts`

Test the schema-driven Form/JSON toggle in the plugin editor.

- [ ] **Step 1: Create the test file**

```typescript
import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/ui';
test.setTimeout(60000);

async function login(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);
  if (page.url().includes('/login')) {
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
  }
}

async function openPluginDrawerAndAdd(page: import('@playwright/test').Page, pluginName: string) {
  await page.goto(`${BASE_URL}/routes/add`);
  await page.waitForTimeout(1000);

  await page.locator('input[name="name"]').fill('test-plugin-form');
  await page.locator('input[name="uri"]').fill('/test-plugin-form');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);

  await page.locator('button:has-text("+Add a Node")').click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="Hostname or IP"]').fill('httpbin.org');
  await page.locator('input[placeholder="Port"]').fill('80');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(500);

  // Skip Request Override
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(500);

  // Open Select Plugins
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  await page.waitForTimeout(1000);

  // Search and add plugin
  await page.locator('[role="dialog"] input[placeholder="Search"]').fill(pluginName);
  await page.waitForTimeout(500);
  await page.locator('[role="dialog"] button:has-text("Add")').first().click();
  await page.waitForTimeout(2000);
}

test.describe('Plugin Schema Form Editor', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Form/JSON toggle is visible for plugins with schema', async ({ page }) => {
    await openPluginDrawerAndAdd(page, 'limit-conn');

    const drawer = page.locator('[role="dialog"]').nth(1);
    await expect(drawer.locator('label:has-text("Form")')).toBeVisible();
    await expect(drawer.locator('label:has-text("JSON")')).toBeVisible();
  });

  test('Form mode shows typed fields for limit-conn', async ({ page }) => {
    await openPluginDrawerAndAdd(page, 'limit-conn');

    const drawer = page.locator('[role="dialog"]').nth(1);

    // Check form fields are visible
    await expect(drawer.locator('label:has-text("conn")')).toBeVisible();
    await expect(drawer.locator('label:has-text("burst")')).toBeVisible();
    await expect(drawer.locator('label:has-text("key")')).toBeVisible();
    await expect(drawer.locator('label:has-text("rejected_code")')).toBeVisible();
    await expect(drawer.locator('label:has-text("policy")')).toBeVisible();
  });

  test('Form values sync to JSON mode', async ({ page }) => {
    await openPluginDrawerAndAdd(page, 'limit-conn');

    const drawer = page.locator('[role="dialog"]').nth(1);

    // Modify conn field
    const connInput = drawer.locator('label:has-text("conn")').locator('xpath=ancestor::*[1]').locator('input').first();
    await connInput.click();
    await connInput.press('Control+a');
    await connInput.type('999');
    await page.waitForTimeout(300);

    // Switch to JSON
    await drawer.locator('label:has-text("JSON")').click();
    await page.waitForTimeout(1000);

    // Read Monaco content
    const jsonContent = await page.evaluate(() => {
      const editors = (window as any).monaco?.editor?.getEditors?.();
      if (editors && editors.length > 0) return editors[editors.length - 1].getValue();
      return null;
    });

    expect(jsonContent).toContain('999');
  });

  test('Plugin saves correctly from form mode', async ({ page }) => {
    await openPluginDrawerAndAdd(page, 'limit-conn');

    const drawer = page.locator('[role="dialog"]').nth(1);

    // Click Add (full-width button)
    await drawer.locator('button[data-block="true"]').click();
    await page.waitForTimeout(1000);

    // Verify plugin card appears
    await expect(page.locator('[data-testid="plugin-limit-conn"]')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd ../apisix-dashboard && pnpm e2e -- e2e/tests/routes.plugin-form.spec.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/routes.plugin-form.spec.ts
git commit -m "test(e2e): add Plugin Schema Form editor tests"
```

---

### Task 7: New test — Reassign Team

**Files:**
- Create: `e2e/tests/routes.reassign-team.spec.ts`

Test the Reassign Team modal on route detail page.

- [ ] **Step 1: Create the test file**

```typescript
import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/ui';
test.setTimeout(60000);

async function login(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);
  if (page.url().includes('/login')) {
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
  }
}

test.describe('Route Detail - Reassign Team', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Reassign Team button visible on route detail page', async ({ page }) => {
    // Switch to Local APISIX which has routes
    const instanceSelect = page.locator('input[placeholder="Select instance"]');
    if (await instanceSelect.isVisible()) {
      await instanceSelect.click();
      await page.waitForTimeout(500);
      const local = page.locator('[role="option"]:has-text("Local")');
      if (await local.isVisible()) {
        await local.click();
        await page.waitForTimeout(1000);
      }
    }

    // Go to routes and open first route detail
    await page.goto(`${BASE_URL}/routes`);
    await page.waitForTimeout(2000);

    const detailLink = page.locator('a[href*="/routes/detail/"]').first();
    if (await detailLink.isVisible()) {
      await detailLink.click();
      await page.waitForTimeout(2000);

      await expect(page.getByRole('button', { name: 'Reassign Team' })).toBeVisible();
    } else {
      test.skip(true, 'No routes available to test');
    }
  });

  test('Reassign Team modal opens with team selector', async ({ page }) => {
    const instanceSelect = page.locator('input[placeholder="Select instance"]');
    if (await instanceSelect.isVisible()) {
      await instanceSelect.click();
      await page.waitForTimeout(500);
      const local = page.locator('[role="option"]:has-text("Local")');
      if (await local.isVisible()) {
        await local.click();
        await page.waitForTimeout(1000);
      }
    }

    await page.goto(`${BASE_URL}/routes`);
    await page.waitForTimeout(2000);

    const detailLink = page.locator('a[href*="/routes/detail/"]').first();
    if (!(await detailLink.isVisible())) {
      test.skip(true, 'No routes available to test');
      return;
    }

    await detailLink.click();
    await page.waitForTimeout(2000);

    // Click Reassign Team
    await page.getByRole('button', { name: 'Reassign Team' }).click();
    await page.waitForTimeout(1000);

    // Modal should be open with team selector
    const modal = page.getByRole('dialog', { name: 'Reassign Team' });
    await expect(modal).toBeVisible();
    await expect(modal.locator('text=Select team')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Reassign' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // Cancel closes the modal
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd ../apisix-dashboard && pnpm e2e -- e2e/tests/routes.reassign-team.spec.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/routes.reassign-team.spec.ts
git commit -m "test(e2e): add Reassign Team modal tests"
```

---

### Task 8: Verify all existing tests pass

**Files:** None (verification only)

Run the full test suite to catch any remaining breakage.

- [ ] **Step 1: Run the full E2E suite**

Run: `cd ../apisix-dashboard && pnpm e2e 2>&1 | tail -40`

- [ ] **Step 2: If any test fails, identify the root cause**

Common failures to watch for:
- Tests navigating to "step 3" (Plugins) that should now be "step 4" — add an extra `clickNext`
- Tests referencing TanStack devtools elements
- Tests importing removed constants

- [ ] **Step 3: Fix any remaining failures and commit**

```bash
git add -A
git commit -m "fix(e2e): resolve remaining test failures from feature changes"
```
