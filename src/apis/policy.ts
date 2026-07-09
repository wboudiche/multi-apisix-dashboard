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

export type PasswordPolicy = {
  min_length: number;
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_symbol: boolean;
  history_depth: number;
  expiry_days: number;
  lockout_threshold: number;
  lockout_window_minutes: number;
};

export type PolicyViolation = {
  code: string;
  params?: Record<string, unknown>;
};

export const policyApi = {
  get: async (): Promise<PasswordPolicy> => {
    const response = await apiClient.get<PasswordPolicy>('/api/v1/settings/password-policy');
    return response.data;
  },
  update: async (policy: PasswordPolicy): Promise<PasswordPolicy> => {
    const response = await apiClient.put<PasswordPolicy>('/api/v1/settings/password-policy', policy);
    return response.data;
  },
};
