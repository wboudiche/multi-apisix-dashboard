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
import type { APISIXType } from '@/types/schema/apisix';

/**
 * An upstream list row, with what the proxy counted for it.
 *
 * None of the three is part of an APISIX upstream, so they are declared here
 * rather than in the schema (#144). Each is absent when that kind could not be
 * read, and `0` when there is none of it: "nothing depends on this" and "I
 * could not count" have opposite consequences for draining or deleting it.
 */
export type UpstreamRow = APISIXType['RespUpstreamList']['data']['list'][number] & {
  value: {
    __route_count?: number;
    __service_count?: number;
    __stream_route_count?: number;
  };
};

/**
 * How many nodes an upstream declares, or undefined when it declares none.
 *
 * APISIX keeps `nodes` in whichever of its two shapes it was written in: a
 * list of `{host, port, weight}`, or an object keyed by `host:port`. An
 * upstream that resolves its nodes through service discovery has neither, and
 * `undefined` is the honest answer for it - the nodes exist, this page just
 * cannot see them.
 */
export const nodeCount = (nodes: unknown): number | undefined => {
  if (Array.isArray(nodes)) return nodes.length;
  if (nodes && typeof nodes === 'object') return Object.keys(nodes).length;
  return undefined;
};
