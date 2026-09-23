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
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The three endpoints that have the dashboard open connections from its own
 * network on the caller's behalf are for the accounts that configure that
 * resource on the instance (#305, #307).
 *
 * The check is a middleware on each route, and the handlers no longer carry
 * one, so only a request through the real router can tell whether a route
 * still has it. These go through the API rather than a page: hiding a button
 * is not the guard, and two of the three endpoints have no page of their own
 * where a refusal would show.
 */

const probes = [
  {
    name: 'test-upstream',
    path: '/api/v1/test-upstream',
    options: { method: 'POST', json: { nodes: [{ host: '10.0.0.1', port: 80 }] } },
  },
  {
    name: 'test-route',
    path: '/api/v1/test-route',
    options: { method: 'POST', json: { method: 'GET', path: '/e2e-probe-access' } },
  },
  {
    name: 'wsdl/fetch',
    // The URL is never fetched: an internal address is refused by the SSRF
    // guard, whoever asks. What this reads is the status of the refusal.
    path: '/api/v1/wsdl/fetch?url=http://10.0.0.1/x.wsdl',
    options: {},
  },
] as const;

const statusOf = async (path: string, token: string, options: object) => {
  try {
    await apiFetch(path, token, options);
    return 200;
  } catch (err) {
    if (err instanceof HttpError) return err.status;
    throw err;
  }
};

test('the probes are refused to an account that configures nothing', async () => {
  const fx = getFixtures();
  const onInstance = { 'X-Instance-ID': fx.localInstanceId };
  const viewer = await loginAdmin(
    fx.users.viewer.username,
    fx.users.viewer.password
  );
  const developer = await loginAdmin(fx.users.dev.username, fx.users.dev.password);

  for (const probe of probes) {
    await test.step(probe.name, async () => {
      const options = { ...probe.options, headers: onInstance };

      expect(await statusOf(probe.path, viewer, options)).toBe(403);
      // The developer's answer depends on what the probe finds; what matters
      // is that it was let through.
      expect(await statusOf(probe.path, developer, options)).not.toBe(403);
      // RBACMiddleware lets a request that names no instance through, so the
      // permission check refuses it itself.
      expect(await statusOf(probe.path, developer, probe.options)).toBe(400);
    });
  }
});
