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

export type Team = {
  id: string;
  name: string;
  description: string;
};

export type TeamMember = {
  user_id: string;
  username: string;
  role: string;
  instance_id: string;
};

export const teamApi = {
  // List all teams
  list: async (): Promise<Team[]> => {
    const response = await apiClient.get<Team[]>('/api/v1/teams');
    return response.data;
  },

  // Create a new team
  create: async (data: Partial<Team>): Promise<Team> => {
    const response = await apiClient.post<Team>('/api/v1/teams', data);
    return response.data;
  },

  // Delete a team
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/teams/${id}`);
  },

  // Get a single team by ID
  getTeam: async (id: string): Promise<Team> => {
    const response = await apiClient.get<{ value: Team }>(`/api/v1/teams/${id}`);
    return response.data.value;
  },

  // Get members of a team
  getMembers: async (id: string): Promise<TeamMember[]> => {
    const response = await apiClient.get<{ list: TeamMember[] }>(`/api/v1/teams/${id}/members`);
    return response.data.list || [];
  },
};
