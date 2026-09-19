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

/**
 * What an upstream's health amounts to, for a page that has to show one thing
 * (#281).
 *
 * Four answers that are not measurements sit alongside the measured ones, and
 * each calls for something different from whoever is reading:
 *
 * - `unknown` — the gateway was never asked. It exposes no Control API, or the
 *   address it was given did not answer. Nothing here knows anything.
 * - `unchecked` — it was asked, and this upstream has no health check. Nothing
 *   is watching it, which is not the same as nothing being wrong.
 * - `pending` — it is watched and nothing has been measured yet. APISIX builds
 *   a checker the first time an upstream is used.
 * - `up` / `mixed` / `down` — measurements, and how many nodes are in
 *   rotation.
 */
export type HealthNode = { host?: string; port?: number; status?: string };

export type HealthSummary =
  | { state: 'unknown' }
  | { state: 'unchecked' }
  | { state: 'pending' }
  | { state: 'up' | 'mixed' | 'down'; up: number; total: number };

/**
 * The states resty.healthcheck keeps a target in while it is still serving.
 *
 * It moves a target through `mostly_healthy` and `mostly_unhealthy` while the
 * counters fill; the first is still in rotation and the second is not. A state
 * this build has never heard of is not counted as serving: the safe reading of
 * an unknown word is that the node may not be.
 */
const IN_ROTATION = new Set(['healthy', 'mostly_healthy']);

/**
 * The states that mean a node is out of rotation. A word outside both sets is
 * one this build has never heard of: it is not counted as serving, and it does
 * not get to paint the row red either - a colour drawn from an unrecognised
 * word would be the firm claim this module exists to avoid.
 */
const OUT_OF_ROTATION = new Set(['unhealthy', 'mostly_unhealthy']);

const isNodeList = (value: unknown): value is HealthNode[] => Array.isArray(value);

/** What to show for one upstream's `__health`, whatever shape it arrived in. */
export const summarizeHealth = (value: unknown): HealthSummary => {
  if (!value || typeof value !== 'object') return { state: 'unknown' };

  const health = value as { checked?: unknown; nodes?: unknown };
  if (health.checked !== true) return { state: 'unchecked' };

  const nodes = isNodeList(health.nodes) ? health.nodes : [];
  if (nodes.length === 0) return { state: 'pending' };

  const statuses = nodes.map((node) => (typeof node?.status === 'string' ? node.status : ''));
  const up = statuses.filter((status) => IN_ROTATION.has(status)).length;
  const down = statuses.filter((status) => OUT_OF_ROTATION.has(status)).length;

  const state =
    up === nodes.length ? 'up' : down === nodes.length ? 'down' : 'mixed';
  return { state, up, total: nodes.length };
};
