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
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * The proxy checks the path it decoded; the gateway decodes what it is sent
 * once more. A segment escaped twice therefore read as an id under a type the
 * caller may write, and reached the gateway as a path into another: a
 * developer, who may not write protos, wrote one in the guise of a route.
 * Every segment is now held to the characters the Admin API keys by, so any
 * such path is refused, whatever it would resolve to.
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = () => ({
  'X-Instance-ID': fx().localInstanceId,
  'X-Team-ID': fx().backendTeamId,
});
const devToken = () => loginAdmin(fx().users.dev.username, fx().users.dev.password);
const proto = { content: 'syntax = "proto3"; package e2e;' };

const written: string[] = [];

test.afterAll(async () => {
  // Only a backend without the fix wrote anything; take it away again.
  const admin = await loginAdmin();
  for (const id of written) {
    await apiFetch(`${PROXY}/protos/${id}`, admin, {
      method: 'DELETE',
      headers: { 'X-Instance-ID': fx().localInstanceId },
    }).catch(() => undefined);
  }
});

const statusOf = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (err: unknown) => (err instanceof HttpError ? err.status : -1)
  );

for (const [name, disguise] of [
  ['escaped dots and slashes', (id: string) => `%252e%252e%252fprotos%252f${id}`],
  ['escaped dots, upper case', (id: string) => `%252E%252E%252fprotos%252f${id}`],
  ['a backslash', (id: string) => `..%5cprotos%5c${id}`],
] as const) {
  test(`a developer cannot write a proto disguised as a route: ${name}`, async () => {
    const id = randomId('e2e-encoded');
    written.push(id);
    const token = await devToken();

    // What the disguise stands in for is refused on its own: the developer
    // role writes no protos.
    expect(
      await statusOf(
        apiFetch(`${PROXY}/protos/${id}`, token, { method: 'PUT', headers: onInstance(), json: proto })
      )
    ).toBe(403);

    expect(
      await statusOf(
        apiFetch(`${PROXY}/routes/${disguise(id)}`, token, {
          method: 'PUT',
          headers: onInstance(),
          json: proto,
        })
      )
    ).toBe(400);

    // And nothing reached the gateway.
    const admin = await loginAdmin();
    expect(
      await statusOf(
        apiFetch(`${PROXY}/protos/${id}`, admin, { headers: { 'X-Instance-ID': fx().localInstanceId } })
      )
    ).toBe(404);
  });
}

test('a read in the same guise is refused as well', async () => {
  const token = await devToken();
  expect(
    await statusOf(
      apiFetch(`${PROXY}/routes/%252e%252e%252fssls`, token, { headers: onInstance() })
    )
  ).toBe(400);
});

// A '?' or '#' decoded from the path ends it, for the gateway, before the id
// the checks read: the write would land on another id than the one whose
// ownership was looked at.
for (const [name, escape] of [
  ['a question mark', '%3F'],
  ['a hash', '%23'],
] as const) {
  test(`a route id holding ${name} is refused`, async () => {
    const token = await devToken();
    const id = randomId('e2e-encoded');
    expect(
      await statusOf(
        apiFetch(`${PROXY}/routes/${id}${escape}x`, token, {
          method: 'PUT',
          headers: onInstance(),
          json: { uri: `/${id}`, upstream: { type: 'roundrobin', nodes: { '127.0.0.1:80': 1 } } },
        })
      )
    ).toBe(400);
  });
}
