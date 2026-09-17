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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MalformedResponseError } from '@/utils/response-shape';

type ClientModule = typeof import('./client');
type UsersModule = typeof import('./users');

// The stores touch localStorage as their modules load, and this suite runs in
// node: the same stand-in client.test.ts installs.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
});

let apiClient: ClientModule['apiClient'];
let userApi: UsersModule['userApi'];
let body: unknown;

beforeAll(async () => {
  ({ apiClient } = await import('./client'));
  ({ userApi } = await import('./users'));
  apiClient.defaults.adapter = async (config) => ({
    data: body,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
});

const user = {
  id: 'u1',
  username: 'someone',
  email: 'someone@example.test',
  role: '',
  created_at: '',
};

beforeEach(() => {
  body = undefined;
});

describe('the users a page is allowed to render', () => {
  it('are the list the backend sent', async () => {
    body = [user];
    await expect(userApi.list()).resolves.toEqual([user]);
  });

  it('are not a body of another shape', async () => {
    // {"total":0} is the misrouted answer #165 describes. It used to reach
    // state, and the next render's `users.map` threw outside every catch.
    body = { total: 0 };
    await expect(userApi.list()).rejects.toBeInstanceOf(MalformedResponseError);
  });
});

describe('a created user', () => {
  it('is returned when the backend answers with one', async () => {
    body = user;
    await expect(userApi.create({ username: 'someone', password: 'x', email: '', role: '' }))
      .resolves.toEqual(user);
  });

  it('is refused without the id the caller addresses the role writes with', async () => {
    // Without this the id was undefined and the assignment went to
    // /user-access/undefined/..., reported as a failed role rather than as a
    // failed create.
    body = { total: 0 };
    await expect(
      userApi.create({ username: 'someone', password: 'x', email: '', role: '' })
    ).rejects.toThrow(/expected the created user/);
  });
});
