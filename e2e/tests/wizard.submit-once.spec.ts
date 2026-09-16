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
 * twice. Cancel stayed enabled beside it, leaving the page while the request
 * it left behind went on creating what the operator had just cancelled (#229).
 */

const prefix = 'e2e_wizard_once';

/** Holds `method` requests to a path ending in `path` until released. */
const holdRequests = async (page: Page, path: string, method: string) => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname.endsWith(path),
    async (route) => {
      if (route.request().method() === method) await released;
      await route.continue();
    }
  );
  return () => release();
};

/** Counts the service creations the page asks for. */
const countPosts = (page: Page) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/apisix/admin/services')
    ) {
      posts.push(request.url());
    }
  });
  return posts;
};

/** Walk the add wizard to the step that submits, the way the crud specs do. */
const openLastStep = async (page: Page, name: string) => {
  await servicesPom.toAdd(page);
  // The page is up before anything is typed into it: the fill otherwise raced
  // the form onto the screen and timed out waiting for a field.
  // A worker's first navigation can be slow on a loaded machine, and the POM's
  // own assertion allows five seconds: wait for the page itself first.
  await expect(page.getByRole('heading', { name: 'Add Service' })).toBeVisible({
    timeout: 30000,
  });
  await servicesPom.isAddPage(page);
  // A name, then a node — the upstream step refuses to advance without one —
  // and on to Preview.
  await uiFillServiceRequiredFields(page, { name });
  return servicesPom.getSubmitBtn(page);
};

test.afterAll(async () => {
  await deleteByPrefix(API_SERVICES, 'name', prefix);
});

test('Enter does not start a second submit while one is in flight', async ({ page }) => {
  const name = randomId(prefix);
  const posts = countPosts(page);
  const submit = await openLastStep(page, name);

  const release = await holdRequests(page, '/apisix/admin/services', 'POST');
  try {
    await submit.click();
    // The first one is on the wire, and the button now refuses a second.
    await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
    await expect(submit).toBeDisabled();

    // Enter, with the focus back on the page where the disabled button left it.
    // A second submit is recorded on its way out, before this route handler
    // releases it, so it would already be counted here.
    await page.keyboard.press('Enter');
    expect(posts).toHaveLength(1);
  } finally {
    release();
  }

  // And still one once the round trip has finished, which is the moment any
  // second submit would have been counted by.
  await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });
  expect(posts).toHaveLength(1);
});

test('Cancel is off while a submit is in flight', async ({ page }) => {
  const name = randomId(prefix);
  const posts = countPosts(page);
  const submit = await openLastStep(page, name);

  const release = await holdRequests(page, '/apisix/admin/services', 'POST');
  try {
    await submit.click();
    await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
    // Leaving now would abandon a request that is still creating the service.
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  } finally {
    release();
  }

  await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });
});
