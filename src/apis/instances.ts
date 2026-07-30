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

import { apiClient } from './client';

export type Instance = {
  id: string;
  name: string;
  description: string;
  admin_api_url: string;
  admin_key: string;
  gateway_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

/**
 * The reason the backend gave for a failure, falling back to `fallback` only
 * when there is nothing to report.
 *
 * Every instance handler answers with `{"error": "<reason>"}`, so collapsing a
 * 403, a binding error and an etcd outage into one generic message throws away
 * the only thing that tells the operator what to do next.
 */
export const describeError = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const reason = (error.response?.data as { error?: string } | undefined)?.error;
    if (reason) return reason;
    if (error.message) return error.message;
  }
  return fallback;
};

export type InstanceHealth = {
  instance_id: string;
  name: string;
  status: 'Connected' | 'Disconnected';
  last_check: string;
  error?: string;
};

export type CreateInstanceRequest = {
  name: string;
  description?: string;
  admin_api_url: string;
  admin_key: string;
  gateway_url?: string;
  is_active?: boolean;
};

export type Scope = {
  tags?: string[];
  path_prefixes?: string[];
};

export type UserInstanceRole = {
  user_id: string;
  instance_id: string;
  team_id: string;
  role: 'instance_admin' | 'developer' | 'viewer';
  scope?: Scope;
};

export type SetUserRoleRequest = {
  role: string;
  team_id: string;
  scope?: Scope;
};

export const instanceApi = {
  // List all instances
  list: async (): Promise<Instance[]> => {
    const response = await apiClient.get<Instance[]>('/api/v1/instances');
    return response.data;
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
    return response.data;
  },

  // Assign role and scope to user for instance
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

  // Remove user role from instance
  removeUserRole: async (userId: string, instanceId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/users/${userId}/instances/${instanceId}/role`);
  },

  // Get user's instances
  getUserInstances: async (userId: string): Promise<UserInstanceRole[]> => {
    const response = await apiClient.get<UserInstanceRole[]>(`/api/v1/user-access/${userId}/instances`);
    return response.data;
  },
};
