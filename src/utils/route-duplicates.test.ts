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

import { type ComparableRoute, findRouteDuplicates } from './route-duplicates';

const existing: ComparableRoute[] = [
  { id: '1', name: 'test', uri: '/test', methods: ['GET'] },
  { id: '2', name: 'billing', uri: '/services/Billing', methods: ['POST'] },
  { id: '3', name: 'catch-all', uri: '/any' },
  { id: '4', name: 'multi', uris: ['/a', '/b'], methods: ['GET'] },
];

const reasonsFor = (id: string, found: ReturnType<typeof findRouteDuplicates>) =>
  found.find((d) => d.id === id)?.reasons ?? [];

describe('findRouteDuplicates', () => {
  it('flags an identical name and path — the case from the report', () => {
    const found = findRouteDuplicates(existing, { name: 'test', uri: '/test', methods: ['GET'] });

    expect(found.map((d) => d.id)).toEqual(['1']);
    expect(reasonsFor('1', found).sort()).toEqual(['name', 'path']);
  });

  it('flags a name clash even when the path differs', () => {
    const found = findRouteDuplicates(existing, { name: 'TEST', uri: '/elsewhere' });

    expect(reasonsFor('1', found)).toEqual(['name']);
  });

  it('compares names case-insensitively and ignores surrounding space', () => {
    const found = findRouteDuplicates(existing, { name: '  Test  ', uri: '/elsewhere' });

    expect(reasonsFor('1', found)).toEqual(['name']);
  });

  it('flags a path clash even when the name differs', () => {
    const found = findRouteDuplicates(existing, { name: 'something-else', uri: '/test', methods: ['GET'] });

    expect(reasonsFor('1', found)).toEqual(['path']);
  });

  it('does not flag the same path under a different method', () => {
    const found = findRouteDuplicates(existing, { name: 'new', uri: '/test', methods: ['POST'] });

    expect(found).toEqual([]);
  });

  it('treats a route with no methods as answering all of them', () => {
    // `/any` declares no methods, so anything on that path collides with it.
    const found = findRouteDuplicates(existing, { name: 'new', uri: '/any', methods: ['DELETE'] });

    expect(reasonsFor('3', found)).toEqual(['path']);
  });

  it('matches against every path of a multi-uri route', () => {
    const found = findRouteDuplicates(existing, { name: 'new', uri: '/b', methods: ['GET'] });

    expect(reasonsFor('4', found)).toEqual(['path']);
  });

  it('matches when the candidate itself declares several paths', () => {
    const found = findRouteDuplicates(existing, { name: 'new', uris: ['/zzz', '/test'], methods: ['GET'] });

    expect(reasonsFor('1', found)).toEqual(['path']);
  });

  it('ignores the route being edited', () => {
    const found = findRouteDuplicates(
      existing,
      { name: 'test', uri: '/test', methods: ['GET'] },
      '1'
    );

    expect(found).toEqual([]);
  });

  it('finds nothing for a genuinely new route', () => {
    const found = findRouteDuplicates(existing, { name: 'brand-new', uri: '/brand-new', methods: ['GET'] });

    expect(found).toEqual([]);
  });

  it('reports every clashing route, not just the first', () => {
    // A gateway legitimately holding many routes on one path — 14 of them is
    // real, observed on a live gateway — must surface all of them.
    const many: ComparableRoute[] = Array.from({ length: 5 }, (_, i) => ({
      id: `dup-${i}`,
      name: `billing-${i}`,
      uri: '/services/Billing',
      methods: ['POST'],
    }));

    const found = findRouteDuplicates(many, { name: 'new', uri: '/services/Billing', methods: ['POST'] });

    expect(found).toHaveLength(5);
  });

  it('does not flag a nameless candidate on name alone', () => {
    const nameless: ComparableRoute[] = [{ id: '9', name: '', uri: '/x' }];

    expect(findRouteDuplicates(nameless, { uri: '/other' })).toEqual([]);
  });
});
