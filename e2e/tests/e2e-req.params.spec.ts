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
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { e2eReq } from '@e2e/utils/req';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

import { API_ROUTES, API_SERVICES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * e2eReq is the axios instance specs seed and read the gateway through. Its
 * adapter built each request URL from the base and the path alone and never
 * read the params: every page, page_size and filter a spec passed was dropped,
 * and the full, unfiltered list came back without a word (#185).
 */

const PROXY = '/api/v1/apisix/admin';
const prefix = randomId('e2e_req_params');
const names = [`${prefix}_a`, `${prefix}_b`];
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

// Services, whose labels are not checked against the catalog the way a route's
// are: the first carries both labels, the second only one of them.
const services = [
  { name: `${prefix}_both`, labels: { e2e_req_a: 'on', e2e_req_b: 'on' } },
  { name: `${prefix}_one`, labels: { e2e_req_a: 'on' } },
];

type RouteList = { data: { list: { value: APISIXType['Route'] }[]; total: number } };
type ServiceList = { data: { list: { value: APISIXType['Service'] }[]; total: number } };

test.beforeAll(async () => {
  const token = await loginAdmin();
  for (const name of names) {
    await apiFetch(`${PROXY}/routes/${name}`, token, {
      method: 'PUT',
      headers: onLocal(),
      json: { name, uri: `/${name}`, upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } } },
    });
  }
  for (const service of services) {
    await apiFetch(`${PROXY}/services/${service.name}`, token, {
      method: 'PUT',
      headers: onLocal(),
      json: service,
    });
  }
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const name of names) {
    await apiFetch(`${PROXY}/routes/${name}`, token, { method: 'DELETE', headers: onLocal() }).catch(
      () => undefined
    );
  }
  for (const service of services) {
    await apiFetch(`${PROXY}/services/${service.name}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
});

test('sends the query parameters it is given', async () => {
  const res = await e2eReq.get<unknown, RouteList>(API_ROUTES, {
    params: { name: prefix, page: 1, page_size: 1 },
  });

  // Filtered by name on the server, then cut to a page of one: both routes
  // match, and one comes back.
  expect(res.data.total).toBe(2);
  expect(res.data.list).toHaveLength(1);
  expect(res.data.list[0].value.name).toMatch(new RegExp(`^${prefix}_`));
});

test('sends a repeated filter the way the gateway reads it', async () => {
  // Through the dashboard's serializer, `label=a&label=b`: both labels are
  // required, and only one service carries them both. axios's own would send
  // `label[]=`, which the proxy does not read, and both would come back.
  const res = await e2eReq.get<unknown, ServiceList>(API_SERVICES, {
    params: { name: prefix, label: ['e2e_req_a:on', 'e2e_req_b:on'] },
  });

  expect(res.data.total).toBe(1);
  expect(res.data.list.map((row) => row.value.name)).toEqual([`${prefix}_both`]);
});
