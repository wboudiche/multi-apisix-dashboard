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

export type LabelTaxonomy = {
  key: string;
  display_name: string;
  color: string;
  values: string[];
  created_by: string;
  created_at: number;
  updated_at: number;
};

type LabelListResponse = {
  list: LabelTaxonomy[];
  total: number;
};

export const labelApi = {
  list: async (): Promise<LabelTaxonomy[]> => {
    const instanceId = localStorage.getItem('instance:current_id') || '';
    const response = await apiClient.get<LabelListResponse>('/api/v1/labels', {
      headers: { 'X-Instance-ID': instanceId },
    });
    return response.data?.list || [];
  },
};
