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
import { queryOptions } from '@tanstack/react-query';
import axios from 'axios';

import { MalformedResponseError } from '@/utils/response-shape';

import { instanceApi } from './instances';
import { teamApi } from './teams';

/**
 * Retry what heals on its own, and nothing else.
 *
 * Two kinds of answer never change by being asked again:
 *
 * - A malformed body throws deterministically - the response interceptor
 *   rejects one that was never JSON, parseRecordList one that is JSON of the
 *   wrong shape - so retrying only spends seven seconds arriving at the same
 *   answer, with the page on a spinner.
 * - A 4xx is the backend's considered answer. /api/v1/teams replies 403 to
 *   every non-admin by design, and retrying that is three more refusals and
 *   seven seconds of backoff on every page load of every developer's session.
 *
 * A 5xx or a dropped connection still gets the default attempts, because those
 * do heal on their own.
 */
const retryTransient = (attempt: number, error: Error): boolean => {
  if (error instanceof MalformedResponseError) return false;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status !== undefined && status < 500) return false;
  return attempt < 3;
};

/**
 * The instance list, read once for the whole app.
 *
 * It used to be read three times over: InstanceGuard had its own query, the
 * header an effect of its own, and the instances page a third read - two round
 * trips on every page load, three notions of the same list, and three places a
 * fix had to land. It also produced a dead end: the guard's "Try again" could
 * not re-drive the header's effect, so it had to reload the page instead
 * (#165).
 *
 * Keyed by user: signing out navigates client-side, so without it the next
 * account is waved through on the list the previous one saw until the refetch
 * lands.
 */
export const instancesQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: ['instances', userId],
    queryFn: () => instanceApi.list(),
    staleTime: 30_000,
    retry: retryTransient,
  });

/**
 * The account's own instance assignments: the list usePermission reads a role
 * out of.
 *
 * Everyone may read their own, so a failure here is a fault rather than the
 * ordinary answer - and one that narrows what someone may do, since the
 * fallback is `user.role`, empty for every non-super_admin. It gets the same
 * retry policy as the instance list rather than react-query's default three,
 * so the report arrives when the failure does.
 */
export const userInstancesQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: ['user-instances', userId],
    queryFn: () => instanceApi.getUserInstances(userId!),
    enabled: !!userId,
    staleTime: 30_000,
    retry: retryTransient,
  });

/**
 * The team catalogue, shared by the pages that resolve a team name.
 *
 * `enabled` is the caller's to set: /api/v1/teams is admin-only and answers
 * 403 to everyone else, which is an ordinary answer rather than a fault - and
 * one retryTransient declines to ask again.
 *
 * Keyed by user like the others: signing out navigates client-side, so an
 * unkeyed catalogue would resolve team names for the next account out of the
 * previous account's cache, for as long as it stays fresh.
 */
export const teamsQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: ['teams', userId],
    queryFn: () => teamApi.list(),
    staleTime: 60_000,
    retry: retryTransient,
  });
