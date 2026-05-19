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
import { type APIRequestContext, request } from '@playwright/test';
import axios, { type AxiosAdapter } from 'axios';
import { stringify } from 'qs';

import { API_PREFIX, BASE_PATH } from '@/config/constant';

import { env } from './env';
import { getFixtures } from './fixtures';

const SEED_API =
  process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8086';

export const getPlaywrightRequestAdapter = (
  ctx: APIRequestContext
): AxiosAdapter => {
  return async (config) => {
    const { url, data, baseURL } = config;
    if (typeof url === 'undefined') {
      throw new Error('Need to provide a url');
    }

    type Payload = Parameters<APIRequestContext['fetch']>[1];
    const payload: Payload = {
      headers: config.headers,
      method: config.method,
      failOnStatusCode: true,
      data,
    };
    const urlWithBase = `${baseURL}${url}`;
    const res = await ctx.fetch(urlWithBase, payload);

    try {
      return {
        ...res,
        data: await res.json(),
        config,
        status: res.status(),
        statusText: res.statusText(),
        headers: res.headers(),
      };
    } finally {
      await res.dispose();
    }
  };
};

const adminLogin = async (): Promise<string> => {
  const fx = getFixtures();
  const res = await fetch(`${SEED_API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: fx.users.admin.username,
      password: fx.users.admin.password,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `e2eReq admin login failed: ${res.status} ${await res.text()}`
    );
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
};

export const getE2eReq = async (ctx: APIRequestContext) => {
  const fx = getFixtures();
  const token = await adminLogin();
  const API_URL = env.E2E_TARGET_URL.slice(0, -BASE_PATH.length - 1);

  return axios.create({
    adapter: getPlaywrightRequestAdapter(ctx),
    baseURL: `${API_URL}${API_PREFIX}`,
    paramsSerializer: (p) =>
      stringify(p, {
        arrayFormat: 'repeat',
      }),
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Instance-ID': fx.localInstanceId,
    },
  });
};

export const e2eReq = await getE2eReq(await request.newContext());
