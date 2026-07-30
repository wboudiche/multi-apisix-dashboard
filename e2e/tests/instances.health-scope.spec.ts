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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

import type { InstanceHealth } from '@/apis/instances';

const HEALTH = '/api/v1/instances/health';

// The header polls this endpoint for every signed-in user, so it cannot simply
// be locked to super_admin. It must instead answer with the caller's own scope.
// The viewer fixture holds a role on Local APISIX only, while Staging APISIX is
// also registered — so anything Staging leaking into their response is the bug.
test('health reports only the instances the caller is assigned to', async () => {
  const fx = getFixtures();

  const viewerToken = await loginAdmin(fx.users.viewer.username, fx.users.viewer.password);
  const asViewer = (await apiFetch(HEALTH, viewerToken)) as InstanceHealth[];

  const ids = asViewer.map((entry) => entry.instance_id);
  expect(ids).toContain(fx.localInstanceId);
  expect(ids).not.toContain(fx.stagingInstanceId);

  // A super_admin still sees every instance, so the filtering is scoping the
  // response rather than breaking the endpoint.
  const adminToken = await loginAdmin();
  const asAdmin = (await apiFetch(HEALTH, adminToken)) as InstanceHealth[];
  const adminIds = asAdmin.map((entry) => entry.instance_id);
  expect(adminIds).toContain(fx.localInstanceId);
  expect(adminIds).toContain(fx.stagingInstanceId);
});

test('health does not hand a gateway address to a non-super_admin', async () => {
  const fx = getFixtures();

  const viewerToken = await loginAdmin(fx.users.viewer.username, fx.users.viewer.password);
  const asViewer = (await apiFetch(HEALTH, viewerToken)) as InstanceHealth[];

  // The raw probe error quotes the URL it dialled. Whatever this endpoint says
  // about a failure, it must not spell out where the Admin API lives.
  for (const entry of asViewer) {
    expect(entry.error ?? '').not.toMatch(/https?:\/\//);
    expect(entry.error ?? '').not.toMatch(/:\d{2,5}\b/);
    expect(entry.error ?? '').not.toContain('/apisix/admin');
  }
});
