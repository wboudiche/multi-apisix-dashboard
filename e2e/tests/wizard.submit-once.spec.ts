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
import { servicesPom } from '@e2e/pom/services';
import { deleteByPrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { holdRequests } from '@e2e/utils/hold-requests';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { uiFillServiceRequiredFields } from '@e2e/utils/ui/services';
import { expect, type Page } from '@playwright/test';

import { API_SERVICES } from '@/config/constant';

/**
 * What a wizard does while the submit it started is still in flight.
 *
 * The Submit button carries the page's `loading`, so a second click does
 * nothing. Enter on the last step did not: it called the same handler with no
 * regard for the submit already running, and the resource could be created
 * twice. Cancel stayed enabled beside it, and Escape, Back and the step buttons
 * could all walk the page back to its first step and out of it while the
 * request went on (#229).
 */

const SERVICES = '/apisix/admin/services';

/** Counts the service creations the page asks for. */
const countPosts = (page: Page) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(SERVICES)) {
      posts.push(request.url());
    }
  });
  return posts;
};

/** Walk the add wizard to the step that submits, the way the crud specs do. */
const openLastStep = async (page: Page, name: string) => {
  await servicesPom.toAdd(page);
  // A worker's first navigation can be slow on a loaded machine, and the POM's
  // own check allows five seconds, so the page is waited for first.
  await expect(page.getByRole('heading', { name: 'Add Service' })).toBeVisible({
    timeout: 30000,
  });
  await servicesPom.isAddPage(page);
  // A name, then a node — the upstream step refuses to advance without one —
  // and on to Preview.
  await uiFillServiceRequiredFields(page, { name });
  return servicesPom.getSubmitBtn(page);
};

/**
 * Lets the page paint once. Something that should not happen is otherwise
 * checked before it would have: an assertion that a button is still there
 * passes at once, whatever the key press is about to do.
 */
const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/**
 * The service a test makes, removed in afterEach rather than in the test's own
 * finally. A test that times out is abandoned: its finally runs only once the
 * page has closed under it, alongside the worker's shutdown, and a delete that
 * takes longer than that shutdown is cut off with the service still on the
 * gateway (#243). A hook is awaited.
 */
let created: string | undefined;

const serviceName = (prefix: string) => {
  created = randomId(prefix);
  return created;
};

test.afterEach(async () => {
  const name = created;
  created = undefined;
  if (name) await deleteByPrefix(API_SERVICES, 'name', name);
});

test('Enter does not start a second submit while one is in flight', async ({ page }) => {
  const posts = countPosts(page);
  const submit = await openLastStep(page, serviceName('e2e_wizard_enter'));
  const release = await holdRequests(page, SERVICES, 'POST');
  try {
    await submit.click();
    await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
    await expect(submit).toBeDisabled();
    // The wizard leaves Enter on a button to the button, so this only proves
    // something with the focus elsewhere — where the disabled button left it.
    await expect(submit).not.toBeFocused();
    await page.keyboard.press('Enter');
  } finally {
    release();
  }

  // Counted once the round trip has finished: a second submit, validated
  // before it is sent, would have gone out by then. The first toast is waited
  // for rather than the only one — a second submit brings a toast of its own,
  // and it is the count that should say so.
  await expect(page.getByText('Add Service Successfully').first()).toBeVisible({
    timeout: 30000,
  });
  expect(posts).toHaveLength(1);
});

test('Cancel is off while a submit is in flight', async ({ page }) => {
  const posts = countPosts(page);
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  const submit = await openLastStep(page, serviceName('e2e_wizard_cancel'));
  // On before the submit, so that what follows is the submit's doing.
  await expect(cancel).toBeEnabled();
  const release = await holdRequests(page, SERVICES, 'POST');
  try {
    await submit.click();
    await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
    await expect(cancel).toBeDisabled();
  } finally {
    release();
  }

  await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });
});

test('Escape, Back and the steps do not leave a submit in flight', async ({ page }) => {
  const posts = countPosts(page);
  const submit = await openLastStep(page, serviceName('e2e_wizard_leave'));
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toBeEnabled();
  const release = await holdRequests(page, SERVICES, 'POST');
  try {
    await submit.click();
    await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);

    await expect(back).toBeDisabled();

    // Escape walks back a step at a time and cancels from the first, so as
    // many presses as the wizard has steps would have left the page.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await nextFrame(page);
    await expect(page).toHaveURL(/\/services\/add$/);
    await expect(submit).toBeVisible();

    // A step button, which otherwise goes back freely. Its name is the step's
    // label followed by its description, "Basic Name and hosts".
    await page.getByRole('button', { name: /^Basic\b/ }).click();
    await nextFrame(page);
    await expect(submit).toBeVisible();
  } finally {
    release();
  }

  await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });
  expect(posts).toHaveLength(1);
});
