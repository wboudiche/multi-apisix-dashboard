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

import { API_PREFIX, BASE_PATH } from '@/config/constant';
import { serializeParams } from '@/config/params';

import { env } from './env';
import { getFixtures } from './fixtures';

const SEED_API =
  process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8086';

export const getPlaywrightRequestAdapter = (
  ctx: APIRequestContext
): AxiosAdapter => {
  return async (config) => {
    const { url, data } = config;
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
    // The URL axios itself would send: base, path, and the params run through
    // the instance's paramsSerializer. Built from the base and the path alone,
    // every page, page_size and filter a spec passed was dropped, and the full
    // list came back as though it had been asked for (#185).
    const res = await ctx.fetch(axios.getUri(config), payload);

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
    // The dashboard's own serializer, so a spec's params reach the gateway as
    // the dashboard's would: `filter` encoded the way APISIX reads it rather
    // than as bracketed keys it ignores, and repeatable filters repeated.
    paramsSerializer: serializeParams,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Instance-ID': fx.localInstanceId,
    },
  });
};

export const e2eReq = await getE2eReq(await request.newContext());

/**
 * Every row of a resource list, however many there are.
 *
 * Asked for no particular page, the gateway answers with the whole list. A
 * page_size is a real cap now that e2eReq sends the params it is given (#185),
 * so a read that has to see everything — a sweep, or a count of what should
 * not exist — asks for no page at all.
 */
export const listEvery = async <T = Record<string, unknown>>(apiBase: string) => {
  const res = await e2eReq.get<unknown, { data: { list?: { value: T }[] } }>(apiBase);
  return res.data.list ?? [];
};
