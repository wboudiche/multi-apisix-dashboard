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
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canRoleWrite, RESOURCE_TYPES, type ResourceType, WRITABLE } from './resource-permissions';

/**
 * The backend's table is the authority: the proxy answers 403 by
 * models.RolePermissions whatever the frontend believes. A copy of it here
 * makes the pages honest about what an account may do; this reads the Go file
 * and fails when the two disagree, so the copy cannot drift quietly into
 * offering an edit the gateway refuses.
 *
 * Parsed rather than generated because the shape is one line per role and has
 * been for the life of the file - and because a generator would have to run
 * before typecheck, which is a build step to buy what a test buys here.
 */
const goSource = readFileSync(
  join(import.meta.dirname, '..', '..', 'api', 'internal', 'models', 'models.go'),
  'utf8'
);

const goWritable = (role: string): ResourceType[] => {
  const line = goSource
    .split('\n')
    .find((l) => l.trimStart().startsWith(`Role${role}:`));
  if (!line) throw new Error(`no RolePermissions entry for Role${role} in models.go`);

  return [...line.matchAll(/"([a-z_]+):(\*|read|write)"/g)]
    .filter(([, , action]) => action !== 'read')
    .map(([, resource]) => resource as ResourceType);
};

describe('what the frontend believes a role may write', () => {
  it('is what the backend will actually allow', () => {
    for (const [goRole, role] of [
      ['InstanceAdmin', 'instance_admin'],
      ['Developer', 'developer'],
      ['Viewer', 'viewer'],
    ] as const) {
      const fromGo = goWritable(goRole).sort();
      const allowed = fromGo.filter((resource) => canRoleWrite(role, resource));
      const refused = fromGo.filter((resource) => !canRoleWrite(role, resource));

      expect({ role, refused }).toEqual({ role, refused: [] });
      expect({ role, allowed }).toEqual({ role, allowed: fromGo });
    }
  });

  it('does not claim more than the backend grants', () => {
    // The direction that matters: a page offering an edit the proxy refuses.
    // Every resource type the Go table mentions at all, checked against the
    // role's own writable set.
    const everyResource = [
      ...new Set(
        [...goSource.matchAll(/"([a-z_]+):(?:\*|read|write)"/g)].map(
          ([, r]) => r as ResourceType
        )
      ),
    ];

    for (const [goRole, role] of [
      ['InstanceAdmin', 'instance_admin'],
      ['Developer', 'developer'],
      ['Viewer', 'viewer'],
    ] as const) {
      const writable = new Set(goWritable(goRole));
      const overclaimed = everyResource.filter(
        (resource) => canRoleWrite(role, resource) && !writable.has(resource)
      );
      expect({ role, overclaimed }).toEqual({ role, overclaimed: [] });
    }
  });

  it('names only resources the backend knows', () => {
    // The other direction of drift: a resource renamed on the Go side, or
    // invented on this one, leaves a page asking about something no role can
    // ever be granted - which reads as "you may not write this" for everyone.
    const everyResource = new Set(
      [...goSource.matchAll(/"([a-z_]+):(?:\*|read|write)"/g)].map(([, r]) => r)
    );
    for (const [role, resources] of Object.entries(WRITABLE)) {
      const unknown = resources.filter((resource) => !everyResource.has(resource));
      expect({ role, unknown }).toEqual({ role, unknown: [] });
    }
  });

  it('knows every role the backend has', () => {
    // The direction neither of the mutants above covered: a role added to the
    // Go table and not here reads as "writes nothing", so every page tells it
    // View - quietly, and wrongly.
    const goRoles = [...goSource.matchAll(/^\s*Role([A-Za-z]+):\s*\{/gm)].map(([, r]) => r);
    expect(new Set(goRoles)).toEqual(
      new Set(['SuperAdmin', 'InstanceAdmin', 'Developer', 'Viewer'])
    );

    // super_admin is answered by a branch rather than by the table, so it is
    // pinned here: the day the Go side narrows "*", this says so.
    const superAdminLine = goSource
      .split('\n')
      .find((l) => l.trimStart().startsWith('RoleSuperAdmin:'));
    expect(superAdminLine).toContain('"*"');
  });

  it('names exactly the resource types the backend mentions', () => {
    const everyResource = new Set(
      [...goSource.matchAll(/"([a-z_]+):(?:\*|read|write)"/g)].map(([, r]) => r)
    );
    expect(new Set<string>(RESOURCE_TYPES)).toEqual(everyResource);
  });

  it('answers per resource, not per account', () => {
    // The property the pages rely on, and the one that cannot be seen from the
    // outside today: no reachable role reads a resource it may not write, so
    // this is what would break first if the Go table grew a narrower role.
    expect(canRoleWrite('developer', 'routes')).toBe(true);
    expect(canRoleWrite('developer', 'ssls')).toBe(false);
    expect(canRoleWrite('instance_admin', 'ssls')).toBe(true);
  });

  it('gives a super admin everything and an unknown role nothing', () => {
    expect(canRoleWrite('super_admin', 'ssls')).toBe(true);
    // Until the account's assignments have been read there is no role, and the
    // answer has to be no: '' used to read as "may write" and offered a viewer
    // the controls of the page they had reached (#181).
    expect(canRoleWrite(undefined, 'routes')).toBe(false);
  });
});
