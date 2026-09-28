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
import axios from 'axios';

import { MalformedResponseError } from '@/utils/response-shape';

/**
 * The reason the backend gave for a failure, falling back to `fallback` only
 * when there is nothing to report.
 *
 * Every handler in the Go backend answers with `{"error": "<reason>"}`, so
 * collapsing a 403, a binding error and an etcd outage into one generic message
 * throws away the only thing that tells the operator what to do next.
 */
/**
 * A 429 from the endpoints that dial on the caller's behalf.
 *
 * The dashboard is at its ceiling on outbound tests, which is a state of the
 * dashboard rather than a fault of the request, so the caller reads it in their
 * own language rather than being handed the backend's English sentence (#310).
 */
export const isProbeLimited = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 429;

/**
 * Which ceiling refused a probe: the dashboard's, or this account's share of it.
 *
 * One account could hold every slot and leave everybody else refused, so the
 * ceilings have a per-caller share now, and the two refusals are not the same
 * news - one says wait, the other says you already have several running (#331).
 * An answer that names neither reads as the dashboard's, which is what the
 * refusal was before it had a name.
 */
export const probeLimitKey = (
  error: unknown
): 'error.probeBusy' | 'error.probeBusyCaller' | undefined => {
  if (!isProbeLimited(error)) return undefined;
  const code = axios.isAxiosError(error)
    ? (error.response?.data as { code?: string } | undefined)?.code
    : undefined;
  return code === 'probe_limit_caller' ? 'error.probeBusyCaller' : 'error.probeBusy';
};

export const describeError = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const reason = (error.response?.data as { error?: string } | undefined)?.error;
    if (reason) return reason;
    if (error.message) return error.message;
  }
  // Not an axios error — the response boundary raises it past axios — and its
  // message is the only one that names the request that misrouted. Without
  // this the header and all four call sites on the instances page collapse it
  // into their generic fallback, which is the thing this function exists to
  // stop doing.
  if (error instanceof MalformedResponseError) return error.message;
  return fallback;
};
