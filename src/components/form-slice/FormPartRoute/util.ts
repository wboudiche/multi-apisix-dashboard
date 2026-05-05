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
import { produce } from 'immer';

import { produceRmUpstreamWhenHas } from '@/utils/form-producer';
import { pipeProduce } from '@/utils/producer';

import type { RoutePostType, RoutePutType } from './schema';

export const UPSTREAM_CUSTOM = 'custom';
export const SERVICE_NONE = 'none';

export const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'yellow',
  HEAD: 'gray',
  OPTIONS: 'cyan',
  TRACE: 'pink',
};

export type UpstreamNode = { host: string; port: string | number; weight: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeNodes = (raw: any): UpstreamNode[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([key, weight]) => {
    const lastColon = key.lastIndexOf(':');
    const host = lastColon > 0 ? key.substring(0, lastColon) : key;
    const port = lastColon > 0 ? key.substring(lastColon + 1) : '';
    return { host, port, weight: weight as number };
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nodeHostsFrom = (nodes: any): string[] => {
  if (Array.isArray(nodes)) return nodes.map((n) => n.host || '').filter(Boolean);
  if (nodes) return Object.keys(nodes).map((k) => k.replace(/:\d+$/, ''));
  return [];
};

export const produceVarsToForm = produce((draft: RoutePostType) => {
  if (draft.vars && Array.isArray(draft.vars)) {
    draft.vars = JSON.stringify(draft.vars);
  }
}) as (draft: RoutePostType) => RoutePutType;

export const produceVarsToAPI = produce((draft: RoutePostType) => {
  if (draft.vars && typeof draft.vars === 'string') {
    draft.vars = JSON.parse(draft.vars);
  }
});

export const produceRoute = pipeProduce(
  produceRmUpstreamWhenHas('service_id', 'upstream_id'),
  produceVarsToAPI
);
