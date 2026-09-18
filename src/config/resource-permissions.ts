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
import type { Role } from '@/hooks/usePermission';

/**
 * Every resource type the backend's permission table names.
 *
 * A closed set, so a page asking about "consumer_group" or "ssl" - either of
 * which would quietly answer "you may not write this" for every account -
 * fails to compile instead.
 */
export const RESOURCE_TYPES = [
  'routes', 'services', 'upstreams', 'consumers', 'consumer_groups',
  'stream_routes', 'ssls', 'plugin_configs', 'protos', 'global_rules',
  'secrets', 'plugin_metadata', 'plugins', 'labels',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Which roles may write which resource types.
 *
 * A mirror of `RolePermissions` in api/internal/models/models.go, which is the
 * authority: the proxy answers 403 by that table whatever this one says.
 * Mirrored as it stands, including entries that are not APISIX path segments -
 * `labels` is the dashboard's own catalogue, served by handlers/label.go, which
 * does not consult this table at all.
 *
 * It exists so a page can ask "may this account write *this*" rather than "may
 * it write". Today the two questions have the same answer everywhere they can
 * both be asked: no role reads a resource it cannot also write, except a viewer,
 * which writes nothing. The day the Go table grants a `:read` without a `:*` -
 * which is the ordinary way to add a narrower role - the account-level question
 * starts promising edits the proxy refuses, on whichever page is affected. This
 * is that answer written down before then, not a repair of something broken now.
 *
 * `resource-permissions.test.ts` reads the Go file and fails when the two
 * disagree, so the copy cannot drift quietly.
 */
export const WRITABLE: Record<Exclude<Role, 'super_admin'>, readonly ResourceType[]> = {
  instance_admin: [
    'routes', 'services', 'upstreams', 'consumers', 'ssls', 'plugin_configs',
    'protos', 'global_rules', 'consumer_groups', 'secrets', 'stream_routes',
    'plugin_metadata', 'labels',
  ],
  developer: [
    'routes', 'services', 'upstreams', 'consumers', 'consumer_groups',
    'stream_routes',
  ],
  viewer: [],
};

/**
 * Whether a role may write a resource type.
 *
 * An unknown role writes nothing: the role is undefined until the account's
 * assignments have been read, and until then the answer has to be no (#181).
 */
export const canRoleWrite = (role: Role | undefined, resourceType: ResourceType): boolean => {
  if (role === 'super_admin') return true;
  if (!role) return false;
  return WRITABLE[role]?.includes(resourceType) ?? false;
};
