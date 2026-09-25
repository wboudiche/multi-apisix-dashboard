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
import { isNil } from 'rambdax';

import type { APISIXType } from '@/types/schema/apisix';

/**
 * A weight of 1 where a node carries none.
 *
 * A node added on the form used to be born with a weight of 0, which APISIX's
 * roundrobin never picks beside a node that has one: in the upstream, taking
 * no traffic, with nothing on screen to say so (#303). A 0 typed on purpose is
 * data, and is kept.
 */
const withWeight = (node: APISIXType['UpstreamNode']) => ({
  ...node,
  weight: node.weight ?? 1,
});

/**
 * A new node, for the "Add a Node" button.
 *
 * Only what a node is: the schema's defaults fill every field it has, priority
 * included, and a priority nobody asked for would then be written onto every
 * node added here - the same invention `objToUpstreamNodes` refuses below.
 */
export const genRecord = (data?: APISIXType['UpstreamNode']) =>
  (data ? withWeight(data) : { host: '', port: 1, weight: 1 }) as APISIXType['UpstreamNode'];

/**
 * The host and port of a node as APISIX writes them in the object form of
 * `nodes`, `"host:port"`. An IPv6 address comes bracketed, `"[::1]:8080"`,
 * and splitting such a key on its first colon leaves no host at all.
 */
const splitHostPort = (key: string): { host: string; port: number } => {
  if (key.startsWith('[')) {
    const close = key.indexOf(']');
    const host = close > 1 ? key.slice(1, close) : '';
    if (host) return { host, port: Number(key.slice(close + 2)) || 1 };
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
    // No priority: the object form carries none, and inventing a 0 here would
    // write it onto every node saved from this shape, and make the same node
    // read differently depending on which shape it arrived in.
    const node: APISIXType['UpstreamNode'] = { host, port, weight };
    return node;
  });

/** The nodes a form value holds, in either of the two shapes APISIX takes. */
export const parseToNodes = (data?: APISIXType['UpstreamNodeListOrObj']) => {
  if (isNil(data)) return [];
  if (Array.isArray(data)) return data as APISIXType['UpstreamNodes'];
  return objToUpstreamNodes(data as APISIXType['UpstreamNodeObj']);
};
