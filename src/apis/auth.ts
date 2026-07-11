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

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password?: boolean;
};

export type RefreshRequest = {
  refresh_token: string;
};

export type User = {
  id: string;
  username: string;
  email: string;
  role: string;
  must_change_password?: boolean;
  created_at: string;
};

// Unauthenticated client for login/refresh/logout
const unauthClient = axios.create();

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await unauthClient.post<LoginResponse>('/api/v1/login', data);
    return response.data;
  },

  refresh: async (refreshToken: string): Promise<LoginResponse> => {
    const response = await unauthClient.post<LoginResponse>('/api/v1/refresh', {
      refresh_token: refreshToken,
    });
    return response.data;
  },

  logout: async () => {
    await unauthClient.post('/api/v1/logout');
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>('/api/v1/user');
    return response.data;
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    await apiClient.post('/api/v1/user/password', {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },
};
