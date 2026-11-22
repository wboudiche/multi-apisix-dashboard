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
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import path from 'node:path';

import { randomId } from '@e2e/utils/common';
import { etcdDelete, etcdExists, etcdPut } from '@e2e/utils/etcd';
import { stack } from '@e2e/utils/stack';
import { expect, test } from '@playwright/test';

/**
 * Plugin configs, SSLs and protos became team-owned in #455. On its first
 * start the backend drops the ownership records older versions left for them,
 * once per etcd, and refuses to serve if it cannot: served anyway, those
 * records would go on deciding who sees what.
 *
 * The migration runs at start, so each test starts a backend of its own beside
 * the one the suite drives - the binary CI builds to bin/api (E2E_API_BIN
 * overrides it) - and stops it after.
 *
 * The second test drops every record of those three types in the shared etcd,
 * as the upgrade does: harmless in CI, where one worker runs one spec at a
 * time, but a local parallel run can see another spec's records go.
 */
const API_BIN = process.env.E2E_API_BIN ?? path.resolve('bin/api');
const MARKER = '/config/migrations/team_owned_since_455';
const MIGRATION_FAILED = 'Could not drop the ownership records written before #455';

const backends: ChildProcess[] = [];
const seeded: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  expect(existsSync(API_BIN), API_BIN + ' is missing: go build -C api -o ../bin/api ./cmd').toBe(
    true
  );
});

test.afterEach(async () => {
  for (const proc of backends.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM');
      await once(proc, 'exit');
    }
  }
  for (const key of seeded.splice(0)) {
    await etcdDelete(key).catch(() => undefined);
  }
  // Whatever a test did, the etcd is left migrated: without the marker, the
  // next start of any backend on it would drop the owners recorded since.
  await etcdPut(MARKER, true);
});

/** A port nothing listens on, for a backend to take or for etcd to be absent from. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

/** A backend of this test's own, on etcdEndpoints. */
const startBackend = async (etcdEndpoints: string) => {
  const port = await freePort();
  const proc = spawn(API_BIN, [], {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      PORT: String(port),
      ETCD_ENDPOINTS: etcdEndpoints,
      ADMIN_PASSWORD: 'admin',
      JWT_SECRET: randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backends.push(proc);
  let log = '';
  proc.stdout?.on('data', (chunk) => (log += chunk));
  proc.stderr?.on('data', (chunk) => (log += chunk));
  const exited = once(proc, 'exit').then(([code]) => code as number | null);
  return { port, exited, log: () => log };
};

/** Resolves once the backend answers HTTP: it serves only after the migration. */
const serving = async (port: number) => {
  await expect
    .poll(
      () =>
        fetch('http://127.0.0.1:' + port + '/api/v1/login', { method: 'POST', body: '{}' })
          .then((res) => res.status)
          .catch(() => 0),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
};

const seedRecord = async (instanceId: string, type: string, id: string) => {
  const key = '/ownership/' + instanceId + '/' + type + '/' + id;
  seeded.push(key);
  await etcdPut(key, {
    instance_id: instanceId,
    resource_type: type,
    resource_id: id,
    team_id: 'team-before-455',
  });
  return key;
};

test('a backend that cannot reach etcd for the migration stops instead of serving', async () => {
  // 30s for the migration to give up, and the start before it.
  test.setTimeout(75_000);
  const backend = await startBackend('http://127.0.0.1:' + (await freePort()));

  const code = await Promise.race([
    backend.exited,
    new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), 60_000)),
  ]);

  expect(code, backend.log()).not.toBe('still running');
  expect(code).not.toBe(0);
  expect(backend.log()).toContain(MIGRATION_FAILED);
});

test('the first start drops the records left for plugin configs, ssls and protos, and no others', async () => {
  test.setTimeout(60_000);
  const instanceId = randomId('mig455');
  const ssl = await seedRecord(instanceId, 'ssls', 'ssl1');
  const pluginConfig = await seedRecord(instanceId, 'plugin_configs', 'pc1');
  const proto = await seedRecord(instanceId, 'protos', 'proto1');
  const route = await seedRecord(instanceId, 'routes', 'route1');
  // An etcd the migration has not run on yet.
  await etcdDelete(MARKER);

  const backend = await startBackend(stack.etcd);
  await serving(backend.port);

  expect(await etcdExists(ssl), backend.log()).toBe(false);
  expect(await etcdExists(pluginConfig)).toBe(false);
  expect(await etcdExists(proto)).toBe(false);
  expect(await etcdExists(route)).toBe(true);
  expect(await etcdExists(MARKER)).toBe(true);
});

test('a record written after the migration survives the next start', async () => {
  test.setTimeout(60_000);
  await etcdPut(MARKER, true);
  const ssl = await seedRecord(randomId('mig455'), 'ssls', 'ssl1');

  const backend = await startBackend(stack.etcd);
  await serving(backend.port);

  expect(await etcdExists(ssl), backend.log()).toBe(true);
});
