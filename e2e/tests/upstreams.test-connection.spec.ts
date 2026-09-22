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
import { permission } from '@e2e/pom/permission';
import { upstreamsPom } from '@e2e/pom/upstreams';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiAddNode } from '@e2e/utils/ui/nodes';
import { uiDiscardDraftIfPresent, uiWizardNext } from '@e2e/utils/ui/upstreams';
import { expect } from '@playwright/test';

// The dashboard refuses to connect to an internal address, so Test Connection
// never tries one. It used to show such a node as down, which in a Docker or
// Kubernetes deployment is nearly every upstream (#304). A name that does not
// resolve reads the same, so that the answer cannot list the internal names
// on the dashboard's network.
test('an internal address reads as not tested, not as down', async ({ page }) => {
  await upstreamsPom.toAdd(page);
  await upstreamsPom.isAddPage(page);
  await uiDiscardDraftIfPresent(page);

  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .first()
    .fill('e2e-test-connection');
  await uiWizardNext(page);

  await uiAddNode(page, '10.0.0.1', 8080);
  await uiAddNode(page, 'no-such-host.invalid', 80);
  await page.getByRole('button', { name: 'Test Connection' }).click();

  // The answer comes once every node is done, and the missing name waits on
  // the resolver of the machine running the backend.
  for (const node of ['10.0.0.1:8080', 'no-such-host.invalid:80']) {
    const result = page.getByRole('alert').filter({ hasText: node });
    await expect(result).toContainText(
      'Not tested: the dashboard only tests public addresses it can resolve',
      { timeout: 15000 }
    );
    await expect(result).not.toContainText('Connection failed');
  }
});

// The test has the dashboard open connections on the caller's behalf, so the
// backend keeps it for those who can write upstreams on the instance. A
// viewer is not offered a button that would answer them with a 403.
test('a viewer is not offered the test', async ({ browser }) => {
  // loginAs and switchInstance reload the page more than once.
  test.setTimeout(90_000);
  const fx = getFixtures();
  const id = `e2e-304-${Math.random().toString(36).slice(2, 8)}`;
  const path = `/api/v1/apisix/admin/upstreams/${id}`;
  const token = await loginAdmin();
  const headers = {
    'X-Instance-ID': fx.localInstanceId,
    'X-Team-ID': fx.viewersTeamId,
  };
  await apiFetch(path, token, {
    method: 'PUT',
    headers,
    json: { name: id, type: 'roundrobin', nodes: { '10.0.0.1:8080': 1 } },
  });

  // A context of its own: the worker's stored session belongs to the admin.
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await permission.loginAs(page, fx.users.viewer.username, fx.users.viewer.password);
    await permission.switchInstance(page, 'Local APISIX');
    await page.goto(`/ui/upstreams/detail/${id}`);
    await page.getByRole('button', { name: 'Nodes', exact: true }).click();

    // The button is also hidden while the role is still loading. Wait for
    // the role, and for the node, so the absence below means something.
    await expect(
      page.locator('header').getByText('viewer', { exact: true })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByPlaceholder('Hostname or IP')).toHaveValue('10.0.0.1', {
      timeout: 30000,
    });
    await expect(page.getByRole('button', { name: 'Test Connection' })).toHaveCount(0);
  } finally {
    await context.close();
    await apiFetch(path, token, { method: 'DELETE', headers }).catch(() => undefined);
  }
});

// /test-upstream runs RBACMiddleware, which leaves the caller's assignment
// where the handler reads it. Without it, every developer would get a 403,
// and no unit test would notice: they set the assignment themselves.
test('a developer can test a connection', async ({ browser }) => {
  // loginAs and switchInstance reload the page more than once.
  test.setTimeout(90_000);
  const fx = getFixtures();

  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await permission.loginAs(page, fx.users.dev.username, fx.users.dev.password);
    await permission.switchInstance(page, 'Local APISIX');
    await expect(
      page.locator('header').getByText('developer', { exact: true })
    ).toBeVisible({ timeout: 30000 });

    await upstreamsPom.toAdd(page);
    await upstreamsPom.isAddPage(page);
    await uiDiscardDraftIfPresent(page);
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill('e2e-test-connection-dev');
    await uiWizardNext(page);

    await uiAddNode(page, '10.0.0.1', 8080);
    await page.getByRole('button', { name: 'Test Connection' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '10.0.0.1:8080' })
    ).toContainText('Not tested', { timeout: 15000 });
  } finally {
    await context.close();
  }
});
