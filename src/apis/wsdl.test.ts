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

import { describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/apis/client';
import { fetchWsdl } from '@/apis/wsdl';

vi.mock('@/apis/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { entry: 'e', docs: { e: '<x/>' } } }),
  },
}));

describe('fetchWsdl', () => {
  it('GETs the fetch endpoint with the url param', async () => {
    const out = await fetchWsdl('http://h/s?wsdl');
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/wsdl/fetch', {
      params: { url: 'http://h/s?wsdl' },
    });
    expect(out.entry).toBe('e');
  });
});
