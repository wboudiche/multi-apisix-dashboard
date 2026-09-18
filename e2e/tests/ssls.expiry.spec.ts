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
import { genTLS, randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

import { API_SSLS, PAGE_SIZE_MAX } from '@/config/constant';

/**
 * APISIX stores a certificate's PEM and nothing else: no expiry, no issuer. So
 * the SSL list could say whether a certificate was enabled, and nothing about
 * whether it was about to lapse - which takes the gateway's TLS with it (#145).
 * The proxy parses the PEM and the list shows what it found.
 *
 * The certificates are generated here rather than committed: one that expires
 * "in ten days" has to be made now, and a fixture would quietly become an
 * expired certificate testing the wrong branch.
 */
const soonId = randomId('e2e-145-soon');
const laterId = randomId('e2e-145-later');
const goneId = randomId('e2e-145-gone');

test.beforeAll(async () => {
  for (const [id, days] of [
    [soonId, 10],
    [laterId, 365],
    // Already lapsed: the worst case, and the one the banner used to leave out
    // by counting only what was still inside its window.
    [goneId, -2],
  ] as const) {
    const { cert, key } = await genTLS(days);
    await e2eReq.put(`${API_SSLS}/${id}`, { cert, key, snis: [`${id}.test`] });
  }
});

test.afterAll(async () => {
  for (const id of [soonId, laterId, goneId]) {
    await e2eReq.delete(`${API_SSLS}/${id}`).catch(() => undefined);
  }
});

test('shows how long each certificate has left, and warns about the short ones', async ({
  page,
}) => {
  // The default page size, deliberately: the banner is counted over the whole
  // list rather than the page, and asking for every row would hide that.
  await page.goto('/ui/ssls');

  // The banner speaks for every certificate on the gateway, so it is there
  // whichever page these two landed on.
  await expect(
    page.getByText(/Certificates expired or expiring within 30 days: [1-9]/)
  ).toBeVisible({ timeout: 20000 });

  await page.goto(`/ui/ssls?page_size=${PAGE_SIZE_MAX}`);
  const soonRow = page.getByRole('row').filter({ hasText: `${soonId}.test` });
  const laterRow = page.getByRole('row').filter({ hasText: `${laterId}.test` });
  await expect(soonRow).toHaveCount(1, { timeout: 20000 });

  // Intl formats the countdown, so the exact wording follows the browser's
  // locale; what this pins is that each row says something about its own
  // certificate, and that the two are not given the same answer.
  await expect(soonRow.getByText(/day/)).toBeVisible();
  await expect(laterRow.getByText(/day/)).toBeVisible();
  // 9 or 10: openssl counts from now, and whole days floor to nine a moment
  // after the certificate is written.
  await expect(soonRow.getByText(/in (9|10) days/)).toBeVisible();

  const goneRow = page.getByRole('row').filter({ hasText: `${goneId}.test` });
  await expect(goneRow.getByText('Expired')).toBeVisible();

});

test('counts an expired certificate too, not only the ones still running', async ({
  page,
}) => {
  // Relative to itself, because other specs put certificates on this gateway
  // too: what is pinned is that removing the lapsed one takes the count down
  // with it. Counting only the certificates still inside their last thirty
  // days left the worst case - already expired - out of the banner entirely.
  const banner = page.getByText(/Certificates expired or expiring within 30 days: \d+/);

  await page.goto('/ui/ssls');
  await expect(banner).toBeVisible({ timeout: 20000 });
  const before = Number(/: (\d+)/.exec((await banner.textContent()) ?? '')?.[1]);

  await e2eReq.delete(`${API_SSLS}/${goneId}`);
  await page.goto('/ui/ssls');
  await expect(banner).toBeVisible({ timeout: 20000 });
  const after = Number(/: (\d+)/.exec((await banner.textContent()) ?? '')?.[1]);

  expect(after).toBe(before - 1);
});
