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

vi.mock('@/routeTree.gen', () => ({ routeTree: {} }));
vi.mock('@tanstack/react-router', () => ({ createRouter: () => ({}) }));

const { AUTH_CLIENTS_QUERY, queryClient } = await import('./global');

const write = (fn: () => Promise<unknown>) =>
  queryClient.getMutationCache().build(queryClient, { mutationFn: fn }).execute(undefined);

describe('the clients the auth plugin forms list', () => {
  const key = [AUTH_CLIENTS_QUERY, 'inst', 'team', 'key-auth'];

  it('are marked stale by any write that succeeds', async () => {
    queryClient.setQueryData(key, { holders: [], all: [] });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    await write(async () => 'made');
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('are kept when the write fails', async () => {
    queryClient.setQueryData(key, { holders: [], all: [] });
    await expect(write(async () => Promise.reject(new Error('refused')))).rejects.toThrow();
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('leave the other queries as they are', async () => {
    queryClient.setQueryData(['routes'], []);
    await write(async () => 'made');
    expect(queryClient.getQueryState(['routes'])?.isInvalidated).toBe(false);
  });
});
