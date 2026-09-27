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

import { APISIX } from '@/types/schema/apisix';

import { genRecord, nodeHostsFrom, parseToNodes } from './node-rows';

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

  // No port where the key carries none: a node shown or saved on port 1 is
  // what #306 was reported for, and the previews read this too.
  // toStrictEqual, because toEqual reads a key set to undefined as absent,
  // and "no port" is the whole point here.
  it('keeps a bare IPv6 address whole, and invents no port', () => {
    expect(parseToNodes({ 'fd00::1': 2 })).toStrictEqual([
      { host: 'fd00::1', weight: 2 },
    ]);
  });

  it('invents no port for a key that has none', () => {
    expect(parseToNodes({ 'a.com': 1 })).toStrictEqual([
      { host: 'a.com', weight: 1 },
    ]);
  });

  // A bracket with no separator behind it is not a port either.
  it('invents no port for a key it cannot read past the brackets', () => {
    expect(parseToNodes({ '[::1]8080': 1 })).toStrictEqual([
      { host: '::1', weight: 1 },
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

describe('nodeHostsFrom', () => {
  // The route form offers these as the hosts a route's upstream answers on.
  it('reads the hosts of either shape, without their ports', () => {
    expect(nodeHostsFrom({ 'a.com:8080': 1, '[::1]:80': 1 })).toEqual(['a.com', '::1']);
    expect(nodeHostsFrom([{ host: 'b.com', port: 80, weight: 1 }])).toEqual(['b.com']);
  });

  // The spelling the old one-liner cut in half, stripping /:\d+$/.
  it('keeps a bare IPv6 host whole', () => {
    expect(nodeHostsFrom({ 'fd00::1': 1 })).toEqual(['fd00::1']);
  });

  it('answers nothing for no nodes', () => {
    expect(nodeHostsFrom(undefined)).toEqual([]);
  });
});

describe('the node schema', () => {
  // APISIX takes a node with no port, in either shape, and answers 201: the
  // form used to refuse one, so an upstream stored without a port could not
  // be edited without inventing one.
  it('takes a node with no port', () => {
    expect(APISIX.UpstreamNode.safeParse({ host: 'a.com', weight: 1 }).success).toBe(true);
  });

  // The range still holds for a port that is given.
  it('keeps the port within range when there is one', () => {
    expect(APISIX.UpstreamNode.safeParse({ host: 'a.com', port: 0, weight: 1 }).success).toBe(false);
    expect(APISIX.UpstreamNode.safeParse({ host: 'a.com', port: 70000, weight: 1 }).success).toBe(false);
    expect(APISIX.UpstreamNode.safeParse({ host: 'a.com', port: 8080, weight: 1 }).success).toBe(true);
  });

  it('still wants a host and a weight', () => {
    expect(APISIX.UpstreamNode.safeParse({ weight: 1 }).success).toBe(false);
    expect(APISIX.UpstreamNode.safeParse({ host: 'a.com' }).success).toBe(false);
  });
});
