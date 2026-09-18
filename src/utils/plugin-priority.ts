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
 * Which plugin runs first, and why (#48).
 *
 * APISIX runs every plugin that matches, ordered by priority, highest first.
 * The order they appear in a route's `plugins` object means nothing: it is
 * JSON, and an object has no order - so a list showing them by name, as this
 * dashboard did, says nothing about what actually happens to a request.
 *
 * Each plugin carries a default priority, which the gateway serves alongside
 * its schema (`GET /apisix/admin/plugins?all=true`). A route can override it
 * per plugin with `_meta.priority`.
 */

/** A plugin's configuration on a route, as APISIX stores it. */
export type PluginConfigValue = {
  // _meta carries more than the priority - `disable`, `filter`, an error
  // response - and none of it is this module's business beyond keeping it.
  _meta?: { priority?: unknown } & Record<string, unknown>;
} & Record<string, unknown>;

/** The default priorities the gateway serves, by plugin name. */
export type PluginPriorityDefaults = Record<string, number | undefined>;

/**
 * The priority a plugin will run at: its own override, else the gateway's
 * default for it.
 *
 * `undefined` means neither is known - a plugin this gateway does not list,
 * which the page says rather than guessing a number for. A priority of zero or
 * below is a real answer, so the override is taken on being a number rather
 * than on being truthy.
 */
export const effectivePriority = (
  config: PluginConfigValue | undefined,
  fallback: number | undefined
): number | undefined => {
  const own = config?._meta?.priority;
  if (typeof own === 'number' && Number.isFinite(own)) return own;
  return fallback;
};

/**
 * The plugin names in the order the gateway will run them.
 *
 * Plugins of unknown priority come last: nothing here knows where they belong,
 * and putting them first would claim they run before the ones that do. Ties -
 * and the unknowns among themselves - fall back to the name, so that two
 * renders of the same route show the same order.
 *
 * The input is left alone; the order is returned as a new array.
 */
export const inExecutionOrder = (
  names: string[],
  configs: Record<string, PluginConfigValue>,
  defaults: PluginPriorityDefaults
): string[] =>
  [...names].sort((a, b) => {
    const pa = effectivePriority(configs[a], defaults[a]);
    const pb = effectivePriority(configs[b], defaults[b]);
    if (pa === undefined && pb === undefined) return a.localeCompare(b);
    if (pa === undefined) return 1;
    if (pb === undefined) return -1;
    if (pa !== pb) return pb - pa;
    return a.localeCompare(b);
  });

/**
 * The same configuration with its priority override set, or taken away.
 *
 * `undefined` removes the key rather than writing a zero: the absence of
 * `_meta.priority` means "run at whatever the gateway says", while a zero is a
 * real instruction to run near the end. `_meta` itself goes when nothing else
 * is left in it, so a config the operator never touched does not grow an empty
 * object it will see in the JSON view.
 *
 * The input is left alone.
 */
export const withPriority = (
  config: PluginConfigValue,
  priority: number | undefined
): PluginConfigValue => {
  const { _meta, ...rest } = config;

  // NaN counts as no priority rather than as one: it serialises to null, which
  // the Admin API refuses, and a field mid-edit is the one place it comes from.
  if (priority === undefined || !Number.isFinite(priority)) {
    const { priority: _dropped, ...restMeta } = _meta ?? {};
    void _dropped;
    return Object.keys(restMeta).length > 0 ? { ...rest, _meta: restMeta } : rest;
  }
  return { ...rest, _meta: { ...(_meta ?? {}), priority } };
};
