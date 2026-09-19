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
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * Upstream health comes from APISIX's Control API, which most gateways do not
 * expose (#281). The column has to keep three answers apart that a colour
 * would blur into one:
 *
 * - an upstream nothing watches - no health check configured;
 * - one that is watched with nothing measured yet, since APISIX builds a
 *   checker the first time an upstream is used;
 * - a gateway that could not be asked at all, whose upstreams are not in
 *   trouble - they are unknown.
 */
const PROXY = '/api/v1/apisix/admin';
const suffix = randomId('health');
const watchedId = `e2e-281-watched-${suffix}`;
const plainId = `e2e-281-plain-${suffix}`;

const stagingId = `e2e-281-staging-${suffix}`;

const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });
const onStaging = () => ({ 'X-Instance-ID': getFixtures().stagingInstanceId });

test.beforeAll(async () => {
  const token = await loginAdmin();

  // With an active health check: the gateway reports a checker for it.
  await apiFetch(`${PROXY}/upstreams/${watchedId}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: {
      name: watchedId,
      type: 'roundrobin',
      nodes: { '127.0.0.1:1980': 1 },
      checks: {
        active: {
          type: 'http',
          http_path: '/',
          healthy: { interval: 1, successes: 1 },
          unhealthy: { interval: 1, http_failures: 1 },
        },
      },
    },
  });

  // Without one: nothing watches it, and the page must not read that as bad
  // news.
  await apiFetch(`${PROXY}/upstreams/${plainId}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { name: plainId, type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
  });

  // And one on the gateway that exposes no Control API, which is where the
  // third answer comes from.
  await apiFetch(`${PROXY}/upstreams/${stagingId}`, token, {
    method: 'PUT',
    headers: onStaging(),
    json: { name: stagingId, type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const id of [watchedId, plainId]) {
    await apiFetch(`${PROXY}/upstreams/${id}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
  await apiFetch(`${PROXY}/upstreams/${stagingId}`, token, {
    method: 'DELETE',
    headers: onStaging(),
  }).catch(() => undefined);
});

const healthOf = (page: Page, name: string) =>
  page.getByRole('row').filter({ hasText: name }).getByTestId('upstream-health');

test('tells an upstream nothing watches from one that is watched', async ({ page }) => {
  await page.goto('/ui/upstreams?name=e2e-281-');

  await expect(page.getByRole('row').filter({ hasText: watchedId })).toHaveCount(1, {
    timeout: 30000,
  });

  // Watched, and nothing measured yet: APISIX builds the checker when the
  // upstream is first used, and nothing has used this one.
  await expect(healthOf(page, watchedId)).toHaveText('Not measured yet');

  // Nothing watches the other, which is a fact about its configuration rather
  // than about its backends.
  await expect(healthOf(page, plainId)).toHaveText('No health check');
});

test('says it does not know for a gateway that exposes no Control API', async ({
  page,
}) => {
  // The staging gateway publishes only its Admin API, so the fixture leaves it
  // without a control address - the ordinary case for a deployment.
  await permission.switchInstance(page, 'Staging APISIX');
  await page.goto(`/ui/upstreams?name=${stagingId}`);

  await expect(page.getByRole('row').filter({ hasText: stagingId })).toHaveCount(1, {
    timeout: 30000,
  });
  // Not a colour, and not "no health check" either: nothing was asked, so
  // nothing is known. An upstream here may be perfectly well.
  await expect(healthOf(page, stagingId)).toHaveText('Not known');
});
