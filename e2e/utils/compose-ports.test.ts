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

import { PORT_DEFAULTS } from './stack';

/**
 * Every port these stacks publish can be moved off a busy one.
 *
 * A host that already serves 9090 - Prometheus, in the case that prompted this
 * - does not merely lose the Control API: the container refuses to start, so
 * the Admin API beside it never comes up and every instance registered against
 * it reads as Disconnected. The gateway port had a variable for that reason
 * (#152); the rest did not (#344).
 *
 * Read out of the files rather than listed here, so a port published later is
 * held to the same thing. The dev container's overlay is read too: compose
 * concatenates `ports`, so a literal there pins back what the base file made
 * movable.
 */
const root = path.join(import.meta.dirname, '../..');

const composeFiles = [
  'e2e/server/docker-compose.yml',
  '.devcontainer/docker-compose.override.yml',
  'deploy/docker-compose.yml',
];

type Mapping = { file: string; service: string; mapping: string };

const published: Mapping[] = composeFiles.flatMap((file) => {
  const doc = parse(readFileSync(path.join(root, file), 'utf8')) as {
    services?: Record<string, { ports?: unknown[] }>;
  };
  return Object.entries(doc.services ?? {}).flatMap(([service, spec]) =>
    (spec.ports ?? []).map((entry) => {
      // Compose's long syntax is a mapping, not a string. Nothing here uses it;
      // saying so plainly beats a TypeError from inside an assertion.
      expect(typeof entry, `${file}: ${service} uses compose's long port syntax`).toBe(
        'string'
      );
      return { file, service, mapping: entry as string };
    })
  );
});

/** The host side of a mapping: what a busy host collides with. */
const hostSide = (mapping: string) => {
  // Everything before the container port, which is the last `:`-separated part
  // that is not inside a ${...}. Splitting on the last colon would cut the
  // `:-` of a default in half.
  const withoutVars = mapping.replace(/\$\{[^}]*\}/g, 'V');
  const cut = withoutVars.lastIndexOf(':');
  return cut === -1 ? mapping : mapping.slice(0, cut + mapping.length - withoutVars.length);
};

describe('the stacks', () => {
  it('publish something', () => {
    // The check below passes on an empty list, and a compose file that stopped
    // publishing anything would be a stranger failure than a busy port.
    expect(published.length).toBeGreaterThan(0);
  });

  it.each(published)('let $mapping be moved ($file, $service)', ({ mapping }) => {
    // A short mapping - '9100' - publishes on a host port docker picks, so it
    // cannot collide and needs no variable.
    if (!mapping.includes(':')) return;
    expect(hostSide(mapping)).toMatch(/\$\{[A-Z][A-Z0-9_]*:-\d+\}/);
  });

  it.each(
    published.filter((m) => m.file === 'e2e/server/docker-compose.yml')
  )('publishes $mapping on the port e2e/utils/stack.ts expects', ({ mapping }) => {
    // The other half of the pairing: a default here that drifts from the one
    // the tests and the backend reach the stack by leaves the stack up and
    // every reader pointed at nothing.
    const [, name, fallback] =
      /\$\{([A-Z][A-Z0-9_]*):-(\d+)\}/.exec(hostSide(mapping)) ?? [];
    if (!name) return;
    expect(PORT_DEFAULTS).toHaveProperty(name);
    expect(String(PORT_DEFAULTS[name as keyof typeof PORT_DEFAULTS])).toBe(fallback);
  });
});
