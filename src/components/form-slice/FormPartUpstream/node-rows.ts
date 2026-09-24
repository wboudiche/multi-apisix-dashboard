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

export type DataSource = APISIXType['UpstreamNode'] & APISIXType['ID'];

/**
 * A row: a node plus the id this editor keys its inputs on.
 *
 * A node added here used to be born with a weight of 0, which APISIX's
 * roundrobin never picks when another node has one above it, so the node was
 * in the upstream and took no traffic (#303). `zGetDefault` answers 0 for a
 * required number, and `?? 1` does not replace a 0, so the fallback the code
 * carried never fired. A weight of 0 typed on purpose is still kept.
 */
export const genRecord = (data?: DataSource | APISIXType['UpstreamNode']) => {
  if (!data) {
    return { ...zGetDefault(APISIX.UpstreamNode), id: nanoid(), weight: 1 } as DataSource;
  }
  return { id: nanoid(), ...data, weight: data.weight ?? 1 } as DataSource;
};

/**
 * The rows for `next`, keeping the id of the row that already held each node.
 *
 * The ids are this editor's own: nothing outside it knows them, and a new one
 * is a new element to React, which unmounts the input the caret sits in and
 * takes whatever was being typed or pasted there with it (#306). Rows are
 * matched on the node itself rather than on position, so that a list which
 * lost or gained a row before the one being edited does not hand its id -
 * and its DOM element - to a different node.
 */
export const mergeRowIds = (
  prev: DataSource[],
  next: APISIXType['UpstreamNode'][]
): DataSource[] => {
  const free = new Map<string, string[]>();
  for (const row of prev) {
    const key = `${row.host}:${row.port}`;
    free.set(key, [...(free.get(key) ?? []), row.id]);
  }
  return next.map((node) => {
    const ids = free.get(`${node.host}:${node.port}`);
    const id = ids?.shift();
    return id ? ({ ...node, id } as DataSource) : genRecord(node);
  });
};

const objToUpstreamNodes = (data: APISIXType['UpstreamNodeObj']) => {
  return Object.entries(data).map(([key, val]) => {
    const [host, port] = key.split(':');
    const d: APISIXType['UpstreamNode'] = {
      host,
      port: Number(port) || 1,
      weight: val,
      priority: 0,
    };
    return d;
  });
};

/** The nodes a form value holds, in either of the two shapes APISIX takes. */
export const parseToNodes = (data: APISIXType['UpstreamNodeListOrObj']) => {
  if (isNil(data)) return [];
  if (Array.isArray(data)) return data as APISIXType['UpstreamNodes'];
  return objToUpstreamNodes(data as APISIXType['UpstreamNodeObj']);
};

export const parseToUpstreamNodes = (data: DataSource[] | undefined) => {
  if (!data?.length) return [];
  return data.map((item) => {
    const d: APISIXType['UpstreamNode'] = {
      host: item.host,
      port: item.port,
      weight: item.weight,
      priority: item.priority,
    };
    return d;
  });
};
