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
import { isRecord, parseRecordList } from '@/utils/list-shape';
import { MalformedResponseError } from '@/utils/response-shape';

import type { User } from './auth';
import { apiClient } from './client';

export type CreateUserRequest = {
  username: string;
  password: string;
  email: string;
  role: string;
  must_change_password?: boolean;
};

export type UpdateUserRequest = {
  email: string;
  role: string;
};

const USERS_PATH = '/api/v1/users';

/**
 * The users of the dashboard, read and written through apiClient.
 *
 * The page did this with fetch of its own: no JWT refresh on a 401, and none of
 * the boundary the client carries. It also wrote the body into state before
 * anything looked at it, so a misrouted answer - `{"total":0}` - was committed
 * as `users`, and the next render's `users.map` threw with no catch between it
 * and the root's error component, which replaced the page (#165).
 */
export const userApi = {
  list: async (): Promise<User[]> => {
    const response = await apiClient.get<User[]>(USERS_PATH);
    // Named: the page loads the teams and every user's assignments too, and an
    // unnamed "expected a list" does not say which of them to go and look at.
    return parseRecordList<User>(response.data, USERS_PATH);
  },

  create: async (data: CreateUserRequest): Promise<User> => {
    const response = await apiClient.post<User>(USERS_PATH, data);
    // The caller addresses the per-instance role writes with this id. Without
    // the check they went to /user-access/undefined/..., and the failure was
    // reported against the role rather than against the create.
    if (!isRecord(response.data) || typeof response.data.id !== 'string') {
      throw new MalformedResponseError('expected the created user', USERS_PATH);
    }
    return response.data;
  },

  update: async (id: string, data: UpdateUserRequest): Promise<User> => {
    const response = await apiClient.put<User>(`${USERS_PATH}/${id}`, data);
    return response.data;
  },

  resetPassword: async (id: string, password: string): Promise<void> => {
    await apiClient.put(`${USERS_PATH}/${id}/password`, { password });
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`${USERS_PATH}/${id}`);
  },
};
