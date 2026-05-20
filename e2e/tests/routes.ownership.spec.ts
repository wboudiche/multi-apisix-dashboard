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
import { routesPom } from '@e2e/pom/routes';
import { ownershipMatrixSuite } from '@e2e/utils/ownership-test-helper';
import { e2eReq } from '@e2e/utils/req';

ownershipMatrixSuite({
  resourceLabel: 'route',
  assertTeamChipInRow: true,
  pom: {
    goto: { toIndex: routesPom.toIndex },
    locator: { rowByName: routesPom.rowByName },
  },
  createMinimal: async (page, name) => {
    // Walk the 5-step Add-Route wizard with minimal-but-valid inputs.
    await routesPom.toAdd(page);
    await routesPom.isAddPage(page);

    // Step 1 — API information. The wizard mounts lazily after the
    // route schema + plugins list resolves; explicitly wait for the
    // Name textbox to attach before filling it (was timing out at
    // 30s on CI's slower runners).
    const nameField = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await nameField.waitFor({ state: 'visible', timeout: 30000 });
    await nameField.fill(name);
    await page.getByRole('textbox', { name: 'URI', exact: true }).fill(`/${name}`);
    await page.getByRole('textbox', { name: 'HTTP Methods' }).click();
    await page.getByRole('option', { name: 'GET' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2 — Upstream (single httpbin node)
    await page
      .getByRole('textbox', { name: 'Host', exact: true })
      .first()
      .fill('httpbin.org');
    await page
      .getByRole('spinbutton', { name: 'Port', exact: true })
      .first()
      .fill('80');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3 — Request Override (default, skip)
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4 — Plugins (default, skip)
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5 — Preview, submit
    await routesPom.getAddBtn(page).click();
    await routesPom.toIndex(page);
  },
  cleanup: async (_page, name) => {
    // Delete via the JWT-authed e2eReq. Ignore 404 if the test failed
    // before creating the route.
    try {
      const list = await e2eReq.get('/routes');
      const row = list.data?.list?.find(
        (r: { value: { name?: string } }) => r.value?.name === name
      );
      if (row?.value?.id) {
        await e2eReq.delete(`/routes/${row.value.id}`);
      }
    } catch {
      // Swallow — cleanup is best-effort.
    }
  },
});
