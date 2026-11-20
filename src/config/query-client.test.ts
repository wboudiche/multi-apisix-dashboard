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
import { describe, expect, it } from 'vitest';

import { AUTH_CLIENTS_QUERY, CHANGES_CLIENTS, queryClient } from './query-client';

const write = (fn: () => Promise<unknown>, meta?: Record<string, unknown>) =>
  queryClient.getMutationCache().build(queryClient, { mutationFn: fn, meta }).execute(undefined);

describe('the clients the auth plugin forms list', () => {
  const key = [AUTH_CLIENTS_QUERY, 'inst', 'team', 'key-auth'];
  const kept = () => queryClient.setQueryData(key, { holders: [], all: [] });
  const stale = () => queryClient.getQueryState(key)?.isInvalidated;

  it('are read again after a write that changes the clients', async () => {
    kept();
    expect(stale()).toBe(false);
    await write(async () => 'made', CHANGES_CLIENTS);
    expect(stale()).toBe(true);
  });

  it('are kept after a write that does not', async () => {
    kept();
    await write(async () => 'route saved');
    expect(stale()).toBe(false);
  });

  it('are kept when the write fails', async () => {
    kept();
    await expect(
      write(async () => Promise.reject(new Error('refused')), CHANGES_CLIENTS)
    ).rejects.toThrow();
    expect(stale()).toBe(false);
  });
});
