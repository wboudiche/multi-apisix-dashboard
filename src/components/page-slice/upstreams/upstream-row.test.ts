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
import { describe, expect, it } from 'vitest';

import { nodeCount } from './upstream-row';

describe('nodeCount', () => {
  // APISIX keeps `nodes` in whichever shape it was written in, and both come
  // back on a list. Reading only one of them would show no backends for half
  // the gateway's upstreams.
  it('counts both shapes APISIX stores nodes in', () => {
    expect(nodeCount([{ host: '127.0.0.1', port: 1980, weight: 1 }])).toBe(1);
    expect(nodeCount({ '127.0.0.1:1980': 1, '127.0.0.1:1981': 1 })).toBe(2);
  });

  // Zero nodes is a number, and a real one: an upstream can be left with none,
  // and that is worth showing rather than hiding behind the discovery text.
  it('counts an empty upstream as none', () => {
    expect(nodeCount([])).toBe(0);
    expect(nodeCount({})).toBe(0);
  });

  // undefined is what makes the column say "via dns" instead of a number: the
  // nodes exist, this page cannot see them. A count of 0 would read as "no
  // backends", which is the opposite of what discovery means.
  it('has no count for an upstream that declares no nodes', () => {
    expect(nodeCount(undefined)).toBeUndefined();
    expect(nodeCount(null)).toBeUndefined();
    expect(nodeCount('127.0.0.1:1980')).toBeUndefined();
  });
});
