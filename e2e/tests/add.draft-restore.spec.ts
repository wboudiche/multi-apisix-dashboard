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
import { deleteServicesByNamePrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { uiAddServiceNode } from '@e2e/utils/ui/services';
import { expect, type Page } from '@playwright/test';

/**
 * The route, service and upstream add pages keep an unsaved form as a draft,
 * bring it back on the next visit, and offer to discard it. #212 moved the
 * service and upstream drafts from a ref read while rendering into state, as
 * the route page already had it.
 */

const KINDS = [
  { name: 'service', path: '/ui/services/add', key: 'apisix-service-draft' },
  { name: 'upstream', path: '/ui/upstreams/add', key: 'apisix-upstream-draft' },
  { name: 'route', path: '/ui/routes/add', key: 'apisix-route-draft' },
];

const storedDraft = (page: Page, key: string) =>
  page.evaluate((k) => localStorage.getItem(k), key);

const dropDraft = (page: Page, key: string) =>
  page.evaluate((k) => localStorage.removeItem(k), key);

for (const kind of KINDS) {
  test(`${kind.name}: a draft comes back on the next visit, and Discard Draft drops it`, async ({
    page,
  }) => {
    const name = randomId(`e2e_draft_${kind.name}`);
    const description = `${name} description`;
    await page.goto(kind.path);
    await dropDraft(page, kind.key);
    await page.reload();

    try {
      const nameInput = page.locator('input[name="name"]');
      const descInput = page.locator('textarea[name="desc"]');
      await nameInput.fill(name);
      await descInput.fill(description);
      // Written after the auto-save's 1.5 s debounce.
      await expect
        .poll(() => storedDraft(page, kind.key), { timeout: 10000 })
        .toContain(description);

      // The dirty form asks before the page goes; accept, as a reload would.
      page.on('dialog', (dialog) => dialog.accept());
      await page.reload();

      await expect(nameInput).toHaveValue(name);
      await expect(descInput).toHaveValue(description);
      const discard = page.getByRole('button', { name: 'Discard Draft' });
      await expect(discard).toBeVisible();

      await discard.click();
      await expect(discard).toBeHidden();
      await expect.poll(() => storedDraft(page, kind.key)).toBeNull();
      // Back to the page's own defaults: nothing of the draft is left showing (#224).
      await expect(nameInput).toHaveValue('');
      await expect(descInput).toHaveValue('');
    } finally {
      await dropDraft(page, kind.key);
    }
  });
}

/** Holds the service POST until released, so the submit stays in flight. */
const holdServicePost = async (page: Page) => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/apisix/admin/services', async (route) => {
    if (route.request().method() === 'POST') await released;
    await route.continue();
  });
  return () => release();
};

// Discard Draft remounts the form, which would drop a submit still in flight:
// the wizard's Submit back on for a second POST, and the answer landing on a
// form that is gone. So it is off while the draft is being submitted.
test('service: Discard Draft is off while the draft is being submitted', async ({ page }) => {
  const key = 'apisix-service-draft';
  const name = randomId('e2e_draft_submit');
  await page.goto('/ui/services/add');
  await dropDraft(page, key);
  await page.reload();

  try {
    await page.locator('input[name="name"]').fill(name);
    await expect.poll(() => storedDraft(page, key), { timeout: 10000 }).toContain(name);
    page.on('dialog', (dialog) => dialog.accept());
    await page.reload();
    const discard = page.getByRole('button', { name: 'Discard Draft' });
    await expect(discard).toBeEnabled();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await uiAddServiceNode(page, '127.0.0.1', 80);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    const release = await holdServicePost(page);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(discard).toBeDisabled();
    release();
    await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });
  } finally {
    await dropDraft(page, key);
    await deleteServicesByNamePrefix('e2e_draft_submit');
  }
});
