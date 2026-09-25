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

import { genRecord, parseToNodes } from './node-rows';

describe('genRecord', () => {
  // A new node used to be born at weight 0, which APISIX's roundrobin never
  // picks beside a node that has one: in the upstream, taking no traffic,
  // with nothing on screen to say so (#303).
  it('starts a new node at weight 1', () => {
    expect(genRecord().weight).toBe(1);
  });

  // The schema's defaults would fill in a priority as well, and it would be
  // written onto every node added on the form.
  it('carries only what a node is, and no port to guess', () => {
    expect(genRecord()).toEqual({ host: '', weight: 1 });
  });

});

describe('parseToNodes', () => {
  // No priority: the object form carries none, and a 0 invented here would be
  // written onto every node saved from an upstream that arrived in it.
  it('reads the object form APISIX stores', () => {
    expect(parseToNodes({ 'a.com:8080': 3 })).toEqual([
      { host: 'a.com', port: 8080, weight: 3 },
    ]);
  });

  // Splitting on the first colon left no host at all, and the editor then
  // offered to save the upstream with an empty host on port 1.
  it('reads a bracketed IPv6 node', () => {
    expect(parseToNodes({ '[::1]:8080': 1 })).toEqual([
      { host: '::1', port: 8080, weight: 1 },
    ]);
  });

  it('keeps a bare IPv6 address whole, port or not', () => {
    expect(parseToNodes({ 'fd00::1': 2 })).toEqual([
      { host: 'fd00::1', port: 1, weight: 2 },
    ]);
  });

  // Shapes APISIX does not write, but which the editor must not turn into
  // something it would then offer to save.
  it('keeps a key it cannot read as an address whole', () => {
    expect(parseToNodes({ 'a.com:8080:extra': 1 })[0].host).toBe('a.com:8080:extra');
    expect(parseToNodes({ '[]:80': 1 })[0].host).toBe('[]');
  });

  it('passes the list form through', () => {
    const nodes = [{ host: 'a.com', port: 80, weight: 1 }];
    expect(parseToNodes(nodes)).toEqual(nodes);
  });

  it('answers nothing for no nodes', () => {
    expect(parseToNodes(undefined)).toEqual([]);
  });
});
