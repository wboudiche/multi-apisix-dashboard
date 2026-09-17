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

import { parseRecordList } from '@/utils/list-shape';

import { apiClient } from './client';

export type Team = {
  id: string;
  name: string;
  description: string;
};

export const teamApi = {
  // List all teams
  list: async (): Promise<Team[]> => {
    const response = await apiClient.get<Team[]>('/api/v1/teams');
    return parseRecordList<Team>(response.data);
  },

  // Create a new team
  create: async (data: Partial<Team>): Promise<Team> => {
    const response = await apiClient.post<Team>('/api/v1/teams', data);
    return response.data;
  },

  // Rename a team or edit its description.
  // Membership is not editable here: a user's team is stored per
  // (user, instance), so it is assigned from the Users screen instead.
  update: async (
    id: string,
    data: Pick<Team, 'name' | 'description'>
  ): Promise<Team> => {
    const response = await apiClient.put<Team>(`/api/v1/teams/${id}`, data);
    return response.data;
  },

  // Delete a team
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/teams/${id}`);
  },


  // Reassign resource ownership to a different team.
  // An empty teamId detaches the resource, leaving it owned by no team — which
  // hides it from every non-admin until an admin assigns it again.
  reassignOwnership: async (resourceType: string, resourceId: string, teamId: string): Promise<void> => {
    await apiClient.put(`/api/v1/apisix/ownership/${resourceType}/${resourceId}`, { team_id: teamId });
  },
};
