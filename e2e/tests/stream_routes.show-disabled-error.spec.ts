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
/* eslint-disable playwright/no-skipped-test -- this spec restarts the gateway;
   skipping it where that is not welcome is the point (#290) */
import { exec } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { streamRoutesPom } from '@e2e/pom/stream_routes';
import { withProxyMode } from '@e2e/utils/apisix-conf';
import { env } from '@e2e/utils/env';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

const execAsync = promisify(exec);

// Where APISIX reads its configuration inside the container. Used to find out
// which file on this machine the running gateway is actually mounting.
const CONF_IN_CONTAINER = '/usr/local/apisix/conf/config.yaml';

/**
 * This spec restarts the gateway, which is not something to do to a stack
 * somebody else is using. It runs on CI, and anywhere else only when asked
 * for explicitly (#290).
 */
const MAY_RESTART =
  !!process.env['CI'] || process.env['E2E_ALLOW_RESTART'] === '1';

const getE2EServerDir = () => {
  // fileURLToPath, not .pathname: the latter stays percent-encoded, and a
  // checkout under a path with a space or an accent would then be compared
  // against docker's decoded one and refused for the wrong reason (#290).
  const currentDir = fileURLToPath(new URL('.', import.meta.url));
  return path.join(currentDir, '../server');
};

const localConfPath = () => path.join(getE2EServerDir(), 'apisix_conf.yml');

/**
 * Refuses to go on unless the gateway about to be restarted is the one reading
 * the file about to be edited.
 *
 * Compose names its project after the directory holding the file - `server`
 * for every checkout of this repo - so `docker compose restart apisix` from a
 * worktree restarts the gateway the *main* checkout started, while the edit
 * lands on a copy that gateway never reads. The spec then waited for a message
 * that could not come, and the only visible result was a gateway restarted
 * under whoever was using it (#290).
 */
const requireOwnGateway = async () => {
  const dir = getE2EServerDir();
  const { stdout: ids } = await execAsync('docker compose ps -q apisix', { cwd: dir });
  // The first line only: a scaled service prints several, and the newline
  // would otherwise be interpolated into the command below and split it in
  // two.
  const id = ids.trim().split('\n')[0];
  if (!id) {
    throw new Error(`no apisix container in the compose project at ${dir}`);
  }

  const { stdout: mounts } = await execAsync(
    `docker inspect ${id} --format '{{range .Mounts}}{{.Destination}}={{.Source}} {{end}}'`
  );
  const mounted = mounts
    .trim()
    .split(/\s+/)
    .find((entry) => entry.startsWith(`${CONF_IN_CONTAINER}=`))
    ?.slice(CONF_IN_CONTAINER.length + 1);

  const local = path.resolve(localConfPath());
  if (mounted !== local) {
    throw new Error(
      `this gateway reads ${mounted ?? 'no config file'}, not ${local}. ` +
        'Restarting it would disturb whoever started it, and the edit would ' +
        'have no effect: run this spec from the checkout that brought the ' +
        'stack up.'
    );
  }
};

const updateAPISIXConf = async (mode: string) => {
  const confPath = localConfPath();
  const conf = await readFile(confPath, 'utf-8');
  // Through the document rather than a re-serialisation: the file is tracked,
  // and everything around the value - the comments above all - has to survive
  // a run (#290).
  await writeFile(confPath, withProxyMode(conf, mode), 'utf-8');
};

const restartDockerServices = async () => {
  await execAsync('docker compose restart apisix', { cwd: getE2EServerDir() });
  const url = env.E2E_TARGET_URL;
  const maxRetries = 20;
  const interval = 1000;
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url).catch(() => ({ ok: false }));
    if (res.ok) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('APISIX is not ready');
};

// Skipped as a file, so the hooks below do not touch anything either.
test.skip(
  !MAY_RESTART,
  'restarts the gateway; set E2E_ALLOW_RESTART=1 to run it against a stack of your own'
);

// Whether the mode was actually taken away, and so whether there is anything
// to put back. Playwright runs afterAll even when beforeAll threw, so without
// this the teardown restarted a gateway the setup had deliberately refused to
// touch - which is the whole point of the guard above (#290).
let streamModeRemoved = false;

test.beforeAll(async () => {
  if (!MAY_RESTART) return;
  await requireOwnGateway();
  await updateAPISIXConf('http');
  streamModeRemoved = true;
  await restartDockerServices();
});

test.afterAll(async () => {
  if (!streamModeRemoved) return;
  await updateAPISIXConf('http&stream');
  await restartDockerServices();
});

test('show disabled error', async ({ page }) => {
  await streamRoutesPom.toIndex(page);

  // Scoped to the page body rather than matched anywhere on screen. The same
  // text arrives twice: once in the page, from the route's error component, and
  // once in a toast raised by the request interceptor. Matching both is a strict
  // mode violation, and whether the toast is still on screen depends on how long
  // the page took to settle — which is what made this test flaky.
  //
  // The page copy is the one this test means: it is what stays put, and the
  // reload below asserts exactly that.
  const disabledError = page
    .getByRole('main')
    .getByText('stream mode is disabled, can not add stream routes');

  // Extra long timeout for CI after the server restart.
  await expect(disabledError).toBeVisible({ timeout: 30000 });

  // Verify the error message is still shown after refresh
  await page.reload();
  await expect(disabledError).toBeVisible({ timeout: 30000 });
});
