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
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Every port this stack publishes can be moved off a busy one.
 *
 * A host that already serves 9090 - Prometheus, in the case that prompted this
 * - does not merely lose the Control API: the container refuses to start, so
 * the Admin API beside it never comes up and every instance registered against
 * it reads as Disconnected. The gateway port had a variable for that reason
 * (#152); the other four did not (#344).
 *
 * Read out of the file rather than listed here, so a port added later is held
 * to the same thing.
 */
const compose = parse(
  readFileSync(path.join(import.meta.dirname, '../server/docker-compose.yml'), 'utf8')
) as { services: Record<string, { ports?: string[] }> };

const published = Object.entries(compose.services).flatMap(([service, spec]) =>
  (spec.ports ?? []).map((mapping) => ({ service, mapping }))
);

describe('the e2e stack', () => {
  it('publishes something', () => {
    // The check below passes on an empty list, and a compose file that stopped
    // publishing anything would be a stranger failure than a busy port.
    expect(published.length).toBeGreaterThanOrEqual(5);
  });

  it.each(published)('lets $mapping be moved ($service)', ({ mapping }) => {
    // The host side of the mapping - what a busy host collides with - is
    // everything before the last colon.
    const host = mapping.slice(0, mapping.lastIndexOf(':'));
    expect(host).toMatch(/\$\{E2E_[A-Z0-9_]+:-\d+\}/);
  });
});
