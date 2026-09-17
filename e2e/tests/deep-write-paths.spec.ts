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
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * APISIX writes a route addressed as /routes/<id>/<anything> to /routes/<id>,
 * but the proxy's checks read the path it was given. Such a write created a
 * route with no team, which its own team could then neither see nor remove
 * (#250). Only the Admin API's own nested resources, a consumer's credentials
 * and a secret under its manager, may be written below <type>/<id>.
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

const ids: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const id of ids.splice(0)) {
    await apiFetch(`${PROXY}/routes/${id}`, token, { method: 'DELETE', headers: onInstance() }).catch(
      () => undefined
    );
  }
});

test('a write deeper than a route is refused rather than written with no team', async () => {
  const id = randomId('e2e-deep');
  ids.push(id);
  const dev = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

  const write = apiFetch(`${PROXY}/routes/${id}/extra`, dev, {
    method: 'PUT',
    headers: onInstance(),
    json: { uri: `/${id}`, upstream: { type: 'roundrobin', nodes: { '127.0.0.1:80': 1 } } },
  });
  await expect(write).rejects.toHaveProperty('status', 400);

  // Nothing was written at /routes/<id> either.
  const read = apiFetch(`${PROXY}/routes/${id}`, await loginAdmin(), { headers: onInstance() });
  await expect(read).rejects.toHaveProperty('status', 404);
});
