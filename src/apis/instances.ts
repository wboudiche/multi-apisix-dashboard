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

import axios from 'axios';

import { parseRecordList } from '@/utils/list-shape';

import { apiClient } from './client';

export type Instance = {
  id: string;
  name: string;
  description: string;
  admin_api_url: string;
  admin_key: string;
  gateway_url: string;
  /**
   * Where this gateway serves APISIX's Control API, or empty. Optional and
   * usually empty: APISIX binds it to loopback by default, so exposing it is
   * deliberate. Upstream health is read from it (#281).
   */
  control_api_url: string;
  is_active: boolean;
  // null for a record the backend has no date for: it stopped serving Go's
  // zero time as though it were one (#321). recordDate reads both.
  created_at: string | null;
  updated_at: string | null;
  /**
   * Set by create/update when the instance was saved but its Admin API did not
   * answer. Never present on a listed instance.
   */
  connection_warning?: string;
};

/**
 * What still references an instance, reported by the backend when a delete is
 * held back. Gateway counts are only meaningful when `reachable` is true.
 */
export type InstanceDependencies = {
  routes: number;
  services: number;
  upstreams: number;
  consumers: number;
  stream_routes: number;
  user_assignments: number;
  ownership_records: number;
  reachable: boolean;
  /** Why the gateway could not be counted; present only when reachable is false. */
  error?: string;
};

/** Machine-readable codes the backend puts on its 409 responses. */
export const INSTANCE_CONFLICT = {
  duplicateName: 'duplicate_instance_name',
  duplicateAdminAPIURL: 'duplicate_admin_api_url',
  hasDependencies: 'instance_has_dependencies',
} as const;

export type InstanceConflict = {
  code?: string;
  error?: string;
  conflicting_instance?: string;
  dependencies?: InstanceDependencies;
};

/**
 * Extracts the backend's structured conflict payload from a rejected request,
 * or null when the failure was something else.
 */
export const getInstanceConflict = (error: unknown): InstanceConflict | null => {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) {
    return null;
  }
  return (error.response.data as InstanceConflict) ?? null;
};

export type InstanceHealth = {
  instance_id: string;
  name: string;
  // Unknown: the refresh did not get to this gateway - it ran out of the
  // budget for the round - so nothing is known about it. Not the same as
  // reached and unwell (#330).
  status: 'Connected' | 'Disconnected' | 'Unknown';
  last_check: string;
  // Why it is not Connected: 'unreachable', 'not_read' or 'unreadable'. A
  // string rather than that union, so a newer backend's code is not a type
  // lie; `healthReason` turns it into words (#340).
  code?: string;
  // The probe's own error, sent to a super_admin only.
  error?: string;
};

export type CreateInstanceRequest = {
  name: string;
  description?: string;
  admin_api_url: string;
  admin_key: string;
  gateway_url?: string;
  control_api_url?: string;
  is_active?: boolean;
};

export type UserInstanceRole = {
  user_id: string;
  instance_id: string;
  /** Every team of the assignment (#301). Absent from a backend before it. */
  team_ids?: string[];
  /** The first of them, as the answer named it when an assignment held one. */
  team_id: string;
  /**
   * The teams among `team_ids` that still exist, by name: in the access list
   * the account reads of itself, where it is the only place a developer or a
   * viewer learns what their teams are called (#301).
   */
  teams?: { id: string; name: string }[];
  role: 'instance_admin' | 'developer' | 'viewer';
};

/**
 * The teams of an assignment as the backend answered it: the list, or the one
 * team of an answer from before the list.
 */
export const teamsOf = (a: UserInstanceRole): string[] =>
  a.team_ids ?? (a.team_id ? [a.team_id] : []);

export type SetUserRoleRequest = {
  role: string;
  /** Every team of the assignment (#301). */
  team_ids: string[];
};

export const instanceApi = {
  // List all instances
  list: async (): Promise<Instance[]> => {
    const response = await apiClient.get<Instance[]>('/api/v1/instances');
    return parseRecordList<Instance>(response.data);
  },

  // Get a specific instance
  get: async (id: string): Promise<Instance> => {
    const response = await apiClient.get<Instance>(`/api/v1/instances/${id}`);
    return response.data;
  },

  // Create a new instance. `force` confirms past a duplicate Admin API URL.
  create: async (data: CreateInstanceRequest, force = false): Promise<Instance> => {
    const response = await apiClient.post<Instance>('/api/v1/instances', data, {
      params: force ? { force: true } : undefined,
    });
    return response.data;
  },

  // Update an instance. `force` confirms past a duplicate Admin API URL.
  update: async (
    id: string,
    data: Partial<CreateInstanceRequest>,
    force = false
  ): Promise<Instance> => {
    const response = await apiClient.put<Instance>(`/api/v1/instances/${id}`, data, {
      params: force ? { force: true } : undefined,
    });
    return response.data;
  },

  // What still references an instance — shown before confirming a delete
  dependencies: async (id: string): Promise<InstanceDependencies> => {
    const response = await apiClient.get<InstanceDependencies>(
      `/api/v1/instances/${id}/dependencies`
    );
    return response.data;
  },

  // Delete an instance. `force` confirms past the dependency check.
  delete: async (id: string, force = false): Promise<void> => {
    await apiClient.delete(`/api/v1/instances/${id}`, {
      params: force ? { force: true } : undefined,
    });
  },

  // Test connection to an instance
  testConnection: async (id: string): Promise<{ status: string }> => {
    const response = await apiClient.get(`/api/v1/instances/${id}/test`);
    return response.data;
  },

  // Get health status for all instances
  listHealth: async (): Promise<InstanceHealth[]> => {
    const response = await apiClient.get<InstanceHealth[]>('/api/v1/instances/health');
    return parseRecordList<InstanceHealth>(response.data);
  },

  // Assign a role and teams to a user for an instance
  setUserRole: async (
    userId: string,
    instanceId: string,
    data: SetUserRoleRequest
  ): Promise<UserInstanceRole> => {
    const response = await apiClient.post<UserInstanceRole>(
      `/api/v1/user-access/${userId}/instances/${instanceId}/role`,
      data
    );
    return response.data;
  },

  /**
   * Take a user's access to an instance away entirely.
   *
   * Distinct from assigning a role of none, which the backend has no notion
   * of: a UserInstance record either exists or it does not, and while it does
   * the RBAC middleware reads a role out of it.
   */
  removeUserRole: async (userId: string, instanceId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/user-access/${userId}/instances/${instanceId}/role`);
  },

  // Get user's instances
  getUserInstances: async (userId: string): Promise<UserInstanceRole[]> => {
    const response = await apiClient.get<UserInstanceRole[]>(`/api/v1/user-access/${userId}/instances`);
    return parseRecordList<UserInstanceRole>(response.data);
  },
};
