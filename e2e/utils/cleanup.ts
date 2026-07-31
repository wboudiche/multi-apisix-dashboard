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
import { getRouteListReq } from '@/apis/routes';
import { getServiceListReq } from '@/apis/services';
import { getUpstreamListReq } from '@/apis/upstreams';
import {
  API_ROUTES,
  API_SERVICES,
  API_UPSTREAMS,
  PAGE_SIZE_MAX,
} from '@/config/constant';

import { e2eReq } from './req';

/**
 * Cleanup scoped to what a spec created.
 *
 * The alternative — deleteAllRoutes and friends — empties the gateway, which
 * is fine against a throwaway stack and catastrophic against anything else.
 * A spec knows the names it used; that is enough to clean up after itself
 * without deciding the fate of everything around it.
 *
 * A spec that finishes normally usually deletes its own fixtures as part of the
 * test. These exist for the case that does the damage: a failed assertion
 * skipping the inline cleanup and leaving a fixture behind for the next run.
 */

/** Deletes routes whose name begins with any of the given prefixes. */
export const deleteRoutesByNamePrefix = async (
  ...prefixes: string[]
): Promise<number> => {
  if (prefixes.length === 0) return 0;

  const { list } = await getRouteListReq(e2eReq, {
    page: 1,
    page_size: PAGE_SIZE_MAX,
  });

  const doomed = list.filter((row) => {
    const name = row.value.name;
    return !!name && prefixes.some((prefix) => name.startsWith(prefix));
  });

  await Promise.all(
    // Tolerant of a 404: the spec may already have deleted it itself, which is
    // the normal path rather than an error.
    doomed.map((row) =>
      e2eReq.delete(`${API_ROUTES}/${row.value.id}`).catch(() => null)
    )
  );

  return doomed.length;
};

/** Deletes services whose name begins with any of the given prefixes. */
export const deleteServicesByNamePrefix = async (
  ...prefixes: string[]
): Promise<number> => {
  if (prefixes.length === 0) return 0;
  const { list } = await getServiceListReq(e2eReq, {
    page: 1,
    page_size: PAGE_SIZE_MAX,
  });
  const doomed = list.filter((row) =>
    prefixes.some((prefix) => row.value.name?.startsWith(prefix))
  );
  await Promise.all(
    doomed.map((row) =>
      e2eReq.delete(`${API_SERVICES}/${row.value.id}`).catch(() => null)
    )
  );
  return doomed.length;
};

/** Deletes upstreams whose name begins with any of the given prefixes. */
export const deleteUpstreamsByNamePrefix = async (
  ...prefixes: string[]
): Promise<number> => {
  if (prefixes.length === 0) return 0;
  const { list } = await getUpstreamListReq(e2eReq, {
    page: 1,
    page_size: PAGE_SIZE_MAX,
  });
  const doomed = list.filter((row) =>
    prefixes.some((prefix) => row.value.name?.startsWith(prefix))
  );
  await Promise.all(
    doomed.map((row) =>
      e2eReq.delete(`${API_UPSTREAMS}/${row.value.id}`).catch(() => null)
    )
  );
  return doomed.length;
};
