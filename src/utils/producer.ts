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
import { clean,type ICleanerOptions } from 'fast-clean';
import { produce } from 'immer';
import { pipe } from 'rambdax';

import { produceTime } from './form-producer';

export const deepCleanEmptyKeys = <T extends object>(
  obj: T,
  opts?: ICleanerOptions
) =>
  clean(obj, {
    nullCleaner: true,
    cleanInPlace: true,
    ...opts,
  });

export const produceDeepCleanEmptyKeys = (opts: ICleanerOptions = {}) =>
  produce((draft) => {
    deepCleanEmptyKeys(draft, opts);
  });

export const rmDoubleUnderscoreKeys = (obj: object) => {
  Object.keys(obj).forEach((key) => {
    const k = key as keyof typeof obj;
    if ((key as string).startsWith('__')) return delete obj[k];
    if (typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
      (obj[k] as object) = rmDoubleUnderscoreKeys(obj[k]);
    }
  });
  return obj;
};

export const produceRmDoubleUnderscoreKeys = produce((draft) => {
  rmDoubleUnderscoreKeys(draft);
});

type WithPlugins = { plugins?: Record<string, unknown> };

/**
 * Names of the plugins configured with an empty object.
 *
 * `{"key-auth": {}}` enables a plugin with its defaults — that is how most auth
 * plugins are switched on — but an empty object is indistinguishable from
 * leftover noise to the deep cleaner below, which drops the entry and makes the
 * plugin silently vanish from the payload.
 */
const emptyConfigPluginNames = (value: unknown): string[] => {
  const plugins = (value as WithPlugins | null | undefined)?.plugins;
  if (!plugins || typeof plugins !== 'object') return [];
  return Object.entries(plugins)
    .filter(
      ([, config]) =>
        !!config &&
        typeof config === 'object' &&
        Object.keys(config as object).length === 0
    )
    .map(([name]) => name);
};

/** Puts back the empty-config plugins the deep cleaner removed. */
const restoreEmptyConfigPlugins = (value: unknown, names: string[]) => {
  if (names.length === 0) return value;
  const target = value as WithPlugins;
  if (!target.plugins) target.plugins = {};
  for (const name of names) {
    if (!(name in target.plugins)) target.plugins[name] = {};
  }
  return value;
};

/**
 * FIXME: type error
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pipeProduce = (...funcs: ((a: any) => unknown)[]) => {
  return <T>(val: T) =>
    produce(val, (draft) => {
      const fs = funcs;
      const piped = pipe(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        ...fs,
        produceRmDoubleUnderscoreKeys,
        produceTime
      )(draft);
      // Record these before cleaning, restore after: the cleaner has no way to
      // tell a deliberately empty plugin config from an empty leftover.
      const emptyPlugins = emptyConfigPluginNames(piped);
      const cleaned = produceDeepCleanEmptyKeys()(piped);
      return restoreEmptyConfigPlugins(cleaned, emptyPlugins) as never;
    }) as T;
};
