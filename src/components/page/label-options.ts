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
import type { LabelTaxonomy } from '@/apis/labels';

export type LabelOption = { key: string; label: string; values: string[] };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * What the label filter offers: the catalogue, then every other label the
 * listed resources carry.
 *
 * The catalogue is what a route may be labelled with from now on, not what the
 * routes carry. An entry removed while routes still bear it, or labels written
 * before the catalogue knew them, stay on the routes and in the table — and
 * could not be filtered by, with the catalogue alone on offer (#190).
 *
 * Keys and values are merged ignoring case, as the proxy matches them
 * (api/internal/handlers/list_filter.go), keeping the catalogue's spelling
 * where it has one. The catalogue keeps its order; what it lacks follows,
 * sorted.
 */
export const labelOptions = (
  catalogue: LabelTaxonomy[],
  inUse: ReadonlyArray<Record<string, string> | undefined>
): LabelOption[] => {
  const options = catalogue.map((l) => ({
    key: l.key,
    label: l.display_name || l.key,
    // null for an entry created with no values, which the backend accepts.
    values: [...(l.values ?? [])],
    added: [] as string[],
  }));
  const byKey = new Map(options.map((o) => [o.key.toLowerCase(), o]));
  const extra: typeof options = [];

  for (const labels of inUse) {
    for (const [key, value] of Object.entries(labels ?? {})) {
      if (typeof value !== 'string') continue;
      let option = byKey.get(key.toLowerCase());
      if (!option) {
        option = { key, label: key, values: [], added: [] };
        byKey.set(key.toLowerCase(), option);
        extra.push(option);
      }
      const seen = [...option.values, ...option.added];
      if (!seen.some((v) => v.toLowerCase() === value.toLowerCase())) {
        option.added.push(value);
      }
    }
  }

  return [...options, ...extra.sort((a, b) => byName(a.key, b.key))].map(
    ({ key, label, values, added }) => ({
      key,
      label,
      values: [...values, ...added.sort(byName)],
    })
  );
};
