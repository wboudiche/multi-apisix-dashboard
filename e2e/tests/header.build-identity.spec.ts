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
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The dashboard is served two ways: the vite dev server, and the official
 * image (the root Dockerfile), which is only as fresh as the release it was
 * built from. Nothing on screen said which one a page was, so a months-old
 * image was indistinguishable from the working tree - which is how #221 came
 * to be reported, and investigated, against behaviour fixed long before it
 * (#237).
 *
 * In the account menu rather than on the Settings page: /settings is
 * super_admin only, and the person who has a page open to report is often not
 * one.
 */
test('says which build the page is, in the account menu', async ({ page }) => {
  await page.goto('/ui/routes');
  await page.getByRole('button', { name: 'admin' }).click();

  // A short commit sha, a branch and a date - asserted by shape rather than by
  // value, which would pin this to whatever commit built it.
  const build = page.getByText(/^Build [0-9a-f]{7,10} \(.+\), \d{4}-\d{2}-\d{2}$/);
  await expect(build).toBeVisible();

  // And readable as written. i18next escapes interpolations for markup by
  // default, slashes included, so every branch named the way this repo names
  // them - fix/237-x - reached the screen as fix&#x2F;237-x: a build line
  // nobody can paste back into the report it exists for.
  await expect(build).not.toContainText('&#x');
});
