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
import { atom, useAtomValue } from 'jotai';

import { currentUserAtom, userInstancesAtom } from '@/stores/auth';
import { currentInstanceIdAtom } from '@/stores/instance';

export type Role = 'super_admin' | 'instance_admin' | 'developer' | 'viewer';

// Resources that developer role can access (from backend RolePermissions)
const DEVELOPER_RESOURCES = new Set([
  '/routes', '/services', '/upstreams', '/consumers', '/consumer_groups',
  '/stream_routes', '/overview', '/plugin_metadata',
]);

// Resources that require super_admin
const SUPER_ADMIN_ONLY = new Set(['/users', '/instances', '/teams']);

export type Permissions = {
  role: Role | undefined;
  isViewer: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAccessRoute: (path: string) => boolean;
};

const effectiveRoleAtom = atom<Role | undefined>((get) => {
  const user = get(currentUserAtom);
  const instanceId = get(currentInstanceIdAtom);
  const userInstances = get(userInstancesAtom);

  const instanceRole = userInstances.find(
    (ui) => ui.instance_id === instanceId
  )?.role;

  return (instanceRole || user?.role) as Role | undefined;
});

const permissionsAtom = atom<Permissions>((get) => {
  const role = get(effectiveRoleAtom);
  const isViewer = role === 'viewer';
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = isSuperAdmin || role === 'instance_admin';
  const canWrite = role !== undefined && !isViewer;

  const canAccessRoute = (path: string) => {
    if (!role) return false;
    if (isSuperAdmin) return true;
    if (SUPER_ADMIN_ONLY.has(path)) return false;
    if (role === 'developer' && !DEVELOPER_RESOURCES.has(path)) return false;
    return true;
  };

  return {
    role,
    isViewer,
    isAdmin,
    isSuperAdmin,
    canCreate: canWrite,
    canEdit: canWrite,
    canDelete: canWrite,
    canAccessRoute,
  };
});

export const usePermission = (): Permissions => {
  return useAtomValue(permissionsAtom);
};
