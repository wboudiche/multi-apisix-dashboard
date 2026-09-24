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
import { nanoid } from 'nanoid';
import { isNil } from 'rambdax';

import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { zGetDefault } from '@/utils/zod';

/** A row of the node editor: a node, plus the id its inputs are keyed on. */
export type DataSource = APISIXType['UpstreamNode'] & APISIXType['ID'];

/**
 * A weight of 1 where a node carries none.
 *
 * A node added on the form used to be born with a weight of 0, which APISIX's
 * roundrobin never picks beside a node that has one: in the upstream, taking
 * no traffic, with nothing on screen to say so (#303). `zGetDefault` answers 0
 * for a required number, and `?? 1` does not replace a 0, so the fallback the
 * code carried never fired. A 0 typed on purpose is data, and is kept; an
 * empty Weight box is not, and used to be repaired on every commit.
 */
const withWeight = (node: APISIXType['UpstreamNode']) => ({
  ...node,
  weight: node.weight ?? 1,
});

/** A new row: for the given node, or an empty one for the "Add a Node" button. */
export const genRecord = (data?: APISIXType['UpstreamNode']): DataSource =>
  ({
    ...(data ? withWeight(data) : { ...zGetDefault(APISIX.UpstreamNode), weight: 1 }),
    id: nanoid(),
  }) as DataSource;

const addressOf = (node: APISIXType['UpstreamNode']) => `${node.host}:${node.port}`;
const nodeKeyOf = (node: APISIXType['UpstreamNode']) =>
  JSON.stringify([node.host, node.port, node.weight, node.priority]);

/** The ids of prev, in the order they appear, under the given key. */
const indexBy = (
  rows: DataSource[],
  keyOf: (node: APISIXType['UpstreamNode']) => string
) => {
  const index = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const ids = index.get(key);
    if (ids) ids.push(row.id);
    else index.set(key, [row.id]);
  }
  return index;
};

/**
 * The rows for `next`, keeping the id of the row that already held each node.
 *
 * The ids are this editor's own: nothing outside it knows them, and a new one
 * is a new element to React, which unmounts the input the caret sits in and
 * takes whatever was being typed or pasted there with it (#306).
 *
 * A node keeps the id of the row that held exactly it, and failing that, of a
 * row on the same host and port - the node being edited, whose weight is
 * changing under the caret. Matching on position instead would hand a row's
 * id, and its element, to a different node as soon as a row before it went.
 */
export const mergeRowIds = (
  prev: DataSource[],
  next: APISIXType['UpstreamNode'][]
): DataSource[] => {
  const byNode = indexBy(prev, nodeKeyOf);
  const byAddress = indexBy(prev, addressOf);
  const taken = new Set<string>();
  const take = (index: Map<string, string[]>, key: string) => {
    const ids = index.get(key);
    while (ids?.length) {
      const id = ids.shift() as string;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
    return undefined;
  };

  // Every unchanged node first, so that one of them cannot lose its row to a
  // node that merely shares its address.
  const exact = next.map((node) => take(byNode, nodeKeyOf(node)));
  return next.map((node, index) => {
    const id = exact[index] ?? take(byAddress, addressOf(node));
    return id ? { ...withWeight(node), id } : genRecord(node);
  });
};

/**
 * The host and port of a node as APISIX writes them in the object form of
 * `nodes`, `"host:port"`. An IPv6 address comes bracketed, `"[::1]:8080"`,
 * and splitting such a key on its first colon leaves no host at all.
 */
const splitHostPort = (key: string): { host: string; port: number } => {
  if (key.startsWith('[')) {
    const close = key.indexOf(']');
    if (close > 0) {
      return {
        host: key.slice(1, close),
        port: Number(key.slice(close + 2)) || 1,
      };
    }
  }
  const colon = key.lastIndexOf(':');
  // Several colons and no brackets: an IPv6 address written bare, with no
  // port to take off it. Keep the address rather than cut it in half.
  if (colon === -1 || key.indexOf(':') !== colon) return { host: key, port: 1 };
  return { host: key.slice(0, colon), port: Number(key.slice(colon + 1)) || 1 };
};

const objToUpstreamNodes = (data: APISIXType['UpstreamNodeObj']) =>
  Object.entries(data).map(([key, weight]) => {
    const { host, port } = splitHostPort(key);
    const node: APISIXType['UpstreamNode'] = { host, port, weight, priority: 0 };
    return node;
  });

/** The nodes a form value holds, in either of the two shapes APISIX takes. */
export const parseToNodes = (data?: APISIXType['UpstreamNodeListOrObj']) => {
  if (isNil(data)) return [];
  if (Array.isArray(data)) return data as APISIXType['UpstreamNodes'];
  return objToUpstreamNodes(data as APISIXType['UpstreamNodeObj']);
};

/** The nodes of the given rows, without the ids, which are none of the form's business. */
export const parseToUpstreamNodes = (data: DataSource[] | undefined) => {
  if (!data?.length) return [];
  return data.map((item) => {
    const node: APISIXType['UpstreamNode'] = {
      host: item.host,
      port: item.port,
      weight: item.weight,
      priority: item.priority,
    };
    return node;
  });
};
