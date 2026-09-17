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
import { isRecord } from '@/utils/list-shape';
import { MalformedResponseError } from '@/utils/response-shape';

import { apiClient } from './client';
import type { InstanceHealth } from './instances';

const OVERVIEW_PATH = '/api/v1/overview';

export type ResourceStats = {
  routes: number;
  services: number;
  upstreams: number;
};

export type OverviewData = {
  total_instances: number;
  active_instances: number;
  global_stats: ResourceStats;
  instance_stats?: ResourceStats;
  current_instance?: InstanceHealth;
  all_instances: InstanceHealth[];
};

const isResourceStats = (value: unknown): value is ResourceStats =>
  isRecord(value) &&
  (['routes', 'services', 'upstreams'] as const).every(
    (field) => typeof value[field] === 'number'
  );

/**
 * One row of the connectivity table, with the fields that table renders.
 *
 * `status` is checked as a string and not against the union it is typed as: a
 * status this dashboard does not know reads as disconnected, in red, carrying
 * its own name - wrong in the colour, right in the text, and a row the operator
 * can still act on. Refusing the body over it would take the whole page away
 * instead, which is worse than the defect it would be reporting.
 */
const isInstanceHealth = (value: unknown): value is InstanceHealth =>
  isRecord(value) &&
  typeof value.instance_id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.status === 'string' &&
  typeof value.last_check === 'string' &&
  (value.error === undefined || typeof value.error === 'string');

/**
 * An overview response as an overview, or a failure saying it was not one.
 *
 * The page reads `data.global_stats.routes` and `data.all_instances.map(...)`
 * behind `data?.`, which guards the response being absent and nothing else. A
 * body of another shape — `{"total":0}`, the misrouted answer #165 describes —
 * therefore threw during render: the route has no error component of its own,
 * so it reached the root's and replaced the page with a stack trace.
 *
 * So every field the page renders is checked, down to the values inside the
 * two lists: a number where React is handed one, a string where it is handed
 * text. A check that stopped at "it is an object" would leave the same crash
 * one property along — `{"all_instances":[null]}` reads `inst.name` — and that
 * is the failure mode this whole class of fix keeps moving rather than closing.
 */
export const parseOverview = (value: unknown): OverviewData => {
  if (!isRecord(value)) {
    throw new MalformedResponseError(
      `expected an overview, got ${Array.isArray(value) ? 'a list' : value === null ? 'null' : typeof value}`,
      OVERVIEW_PATH
    );
  }
  for (const field of ['total_instances', 'active_instances'] as const) {
    if (typeof value[field] !== 'number') {
      throw new MalformedResponseError(
        `expected an overview with a numeric ${field}`,
        OVERVIEW_PATH
      );
    }
  }
  // instance_stats and current_instance are not checked: they are the fields
  // the page never renders. The backend does not even fill instance_stats -
  // it is sent as zeroes on every overview - so a rule about it would be a
  // rule about nothing.
  if (!isResourceStats(value.global_stats)) {
    throw new MalformedResponseError(
      'expected an overview with global_stats counted',
      OVERVIEW_PATH
    );
  }
  if (!Array.isArray(value.all_instances) || !value.all_instances.every(isInstanceHealth)) {
    throw new MalformedResponseError(
      'expected an overview with a list of instance health records',
      OVERVIEW_PATH
    );
  }
  return value as OverviewData;
};

/**
 * The overview, read through apiClient.
 *
 * The page read it with fetch of its own: no JWT refresh on a 401, no boundary,
 * and a non-2xx left the last numbers on screen with nothing said.
 */
export const overviewApi = {
  get: async (forceRefresh = false): Promise<OverviewData> => {
    const response = await apiClient.get<OverviewData>(OVERVIEW_PATH, {
      params: forceRefresh ? { refresh: 'true' } : undefined,
    });
    return parseOverview(response.data);
  },
};
