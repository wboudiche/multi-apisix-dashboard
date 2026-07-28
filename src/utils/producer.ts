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
import { current, isDraft, produce } from 'immer';
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
 * Returns a payload's plugin map as a plain (non-draft) value, so it can be put
 * back untouched after the deep clean has run over everything else.
 *
 * Inside a plugin map an empty object is meaningful data, not leftover noise:
 * `{"key-auth": {}}` enables a plugin with its defaults, and multi-auth's
 * `{"auth_plugins": [{"basic-auth": {}}, {"key-auth": {}}]}` is nothing but
 * such objects. produceDeepCleanEmptyKeys cannot tell those apart from a blank
 * form field, so it deletes them — and once a config is emptied the plugin
 * itself goes, silently stripping authentication from the route.
 *
 * Nothing is lost by skipping the clean here: PluginSchemaForm already drops a
 * field as soon as it is blank (see its handleFieldChange), so plugin configs
 * do not collect the empty leaves the cleaner exists to remove.
 */
const snapshotPlugins = (value: unknown): Record<string, unknown> | undefined => {
  const plugins = (value as WithPlugins | null | undefined)?.plugins;
  if (!plugins || typeof plugins !== 'object') return undefined;
  // current() detaches the draft so the snapshot survives the clean untouched.
  return (isDraft(plugins) ? current(plugins) : plugins) as Record<string, unknown>;
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

      // Snapshot before the clean, overwrite after: whatever the cleaner did to
      // the plugin map is discarded in favour of what the operator configured.
      // Only re-attach when a plugin actually remains — an empty map means they
      // removed them all, and the key should go.
      const plugins = snapshotPlugins(piped);
      const cleaned = produceDeepCleanEmptyKeys()(piped);
      if (plugins && Object.keys(plugins).length > 0) {
        // Safe to assign: `cleaned` is the result of a produce nested inside
        // this one, so immer has not finalized (and frozen) it yet. Mutating
        // `piped` instead would trip immer's "returned a new value *and*
        // modified its draft" guard.
        (cleaned as WithPlugins).plugins = plugins;
      }
      return cleaned as never;
    }) as T;
};
