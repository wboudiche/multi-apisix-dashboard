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

  // Create a new instance
  create: async (data: CreateInstanceRequest): Promise<Instance> => {
    const response = await apiClient.post<Instance>('/api/v1/instances', data);
    return response.data;
  },

  // Update an instance
  update: async (id: string, data: Partial<CreateInstanceRequest>): Promise<Instance> => {
    const response = await apiClient.put<Instance>(`/api/v1/instances/${id}`, data);
    return response.data;
  },

  // Delete an instance
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/instances/${id}`);
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
