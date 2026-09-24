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

import type { APISIXType } from '@/types/schema/apisix';

import { genRecord, mergeRowIds, parseToNodes } from './node-rows';

/**
 * The ids key the node editor's inputs. A row that keeps its id keeps its DOM
 * element, and with it the caret of whoever is typing in it; a row that gets
 * another row's id gets that row's element, which is the same accident in a
 * costume (#306).
 */

type Row = APISIXType['UpstreamNode'] & { id: string };

const row = (host: string, port: number, id: string): Row => ({
  host,
  port,
  weight: 1,
  id,
});
const node = (host: string, port: number): APISIXType['UpstreamNode'] => ({
  host,
  port,
  weight: 1,
});

const idsOf = (rows: Row[]) => rows.map((r) => r.id);
const hostsOf = (rows: Row[]) => rows.map((r) => `${r.host}:${r.port}`);

describe('mergeRowIds', () => {
  it('keeps the id of every row that is still there', () => {
    const prev = [row('a.com', 80, 'id-a'), row('b.com', 80, 'id-b')];
    const merged = mergeRowIds(prev, [node('a.com', 80), node('b.com', 80)]);

    expect(idsOf(merged)).toEqual(['id-a', 'id-b']);
  });

  it('gives a new row an id of its own', () => {
    const prev = [row('a.com', 80, 'id-a')];
    const merged = mergeRowIds(prev, [node('a.com', 80), node('b.com', 80)]);

    expect(merged[0].id).toBe('id-a');
    expect(merged[1].id).not.toBe('id-a');
    expect(merged[1].id).toBeTruthy();
  });

  // Matching on position would give the first row's id to the second node, so
  // the element that was showing a.com would now show b.com - under the caret
  // of whoever was editing it.
  it('does not move an id onto another node when a row before it goes', () => {
    const prev = [
      row('a.com', 80, 'id-a'),
      row('b.com', 80, 'id-b'),
      row('c.com', 80, 'id-c'),
    ];
    const merged = mergeRowIds(prev, [node('b.com', 80), node('c.com', 80)]);

    expect(idsOf(merged)).toEqual(['id-b', 'id-c']);
    expect(hostsOf(merged)).toEqual(['b.com:80', 'c.com:80']);
  });

  it('follows a row that moved rather than its position', () => {
    const prev = [row('a.com', 80, 'id-a'), row('b.com', 80, 'id-b')];
    const merged = mergeRowIds(prev, [node('b.com', 80), node('a.com', 80)]);

    expect(idsOf(merged)).toEqual(['id-b', 'id-a']);
  });

  // The same host and port twice is legal (different weights, say), and the
  // two rows must not end up sharing one id.
  it('gives each of two identical nodes its own id', () => {
    const prev = [row('a.com', 80, 'id-1'), row('a.com', 80, 'id-2')];
    const merged = mergeRowIds(prev, [node('a.com', 80), node('a.com', 80)]);

    expect(idsOf(merged)).toEqual(['id-1', 'id-2']);
  });

  it('keeps what the nodes say, not what the rows said', () => {
    const prev = [row('a.com', 80, 'id-a')];
    const merged = mergeRowIds(prev, [{ host: 'a.com', port: 80, weight: 7 }]);

    expect(merged).toEqual([{ host: 'a.com', port: 80, weight: 7, id: 'id-a' }]);
  });

  it('empties out with the nodes', () => {
    expect(mergeRowIds([row('a.com', 80, 'id-a')], [])).toEqual([]);
  });

  // An empty Weight box gives undefined, and the schema wants a number: the
  // row is repaired, the way every commit used to repair it.
  it('gives a node with no weight the default', () => {
    const merged = mergeRowIds([row('a.com', 80, 'id-a')], [
      { host: 'a.com', port: 80 } as APISIXType['UpstreamNode'],
    ]);

    expect(merged).toEqual([{ host: 'a.com', port: 80, weight: 1, id: 'id-a' }]);
  });

  // Two nodes on one address: the one that did not change keeps its row, so
  // the other cannot take it from under the caret.
  it('prefers the row that held exactly this node', () => {
    const prev = [
      { host: 'a.com', port: 80, weight: 1, id: 'id-1' },
      { host: 'a.com', port: 80, weight: 5, id: 'id-2' },
    ];
    const merged = mergeRowIds(prev, [{ host: 'a.com', port: 80, weight: 5 }]);

    expect(merged).toEqual([{ host: 'a.com', port: 80, weight: 5, id: 'id-2' }]);
  });

  // The weight of the row being edited changes on every keystroke, so an
  // exact match is not there to be had: the address carries the id.
  it('keeps the id while a weight is being changed', () => {
    const merged = mergeRowIds(
      [{ host: 'a.com', port: 80, weight: 1, id: 'id-a' }],
      [{ host: 'a.com', port: 80, weight: 12 }]
    );

    expect(merged).toEqual([{ host: 'a.com', port: 80, weight: 12, id: 'id-a' }]);
  });
});

describe('genRecord', () => {
  // A new node used to be born at weight 0, which APISIX never picks (#303).
  it('starts a new node at weight 1', () => {
    expect(genRecord().weight).toBe(1);
  });

  it('keeps a weight of 0 that was asked for', () => {
    expect(genRecord({ host: 'a.com', port: 80, weight: 0 }).weight).toBe(0);
  });

  it('gives each row an id of its own', () => {
    const node = { host: 'a.com', port: 80, weight: 1 };
    expect(genRecord(node).id).not.toBe(genRecord(node).id);
  });
});

describe('parseToNodes', () => {
  it('reads the object form APISIX stores', () => {
    expect(parseToNodes({ 'a.com:8080': 3 })).toEqual([
      { host: 'a.com', port: 8080, weight: 3, priority: 0 },
    ]);
  });

  // Splitting on the first colon left no host at all, and the editor then
  // offered to save the upstream with an empty host on port 1.
  it('reads a bracketed IPv6 node', () => {
    expect(parseToNodes({ '[::1]:8080': 1 })).toEqual([
      { host: '::1', port: 8080, weight: 1, priority: 0 },
    ]);
  });

  it('keeps a bare IPv6 address whole, port or not', () => {
    expect(parseToNodes({ 'fd00::1': 2 })).toEqual([
      { host: 'fd00::1', port: 1, weight: 2, priority: 0 },
    ]);
  });

  it('passes the list form through', () => {
    const nodes = [{ host: 'a.com', port: 80, weight: 1 }];
    expect(parseToNodes(nodes)).toEqual(nodes);
  });

  it('answers nothing for no nodes', () => {
    expect(parseToNodes(undefined)).toEqual([]);
  });
});
