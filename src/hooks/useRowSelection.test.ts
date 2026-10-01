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

import { selectionOf, tickedAfter } from './useRowSelection';

const PAGE_1 = 'routes@staging?page=1';
const PAGE_2 = 'routes@staging?page=2';
const PROD = 'routes@prod?page=1';

// Batch Delete was handed every id ever ticked on the page, whatever it was
// showing by then, and deleted routes nobody could see (#371).
describe('the selection of a list page', () => {
  it('is what was ticked on this list, while it is on screen', () => {
    expect(selectionOf({ listKey: PAGE_1, ids: ['b', 'a'] }, PAGE_1, ['a', 'b', 'c'])).toEqual([
      'b',
      'a',
    ]);
  });

  it('is not what was ticked on another page', () => {
    expect(selectionOf({ listKey: PAGE_1, ids: ['a', 'b'] }, PAGE_2, ['k', 'l'])).toEqual([]);
  });

  it('is not what was ticked on another instance, though the ids are the same', () => {
    // Two gateways number their routes from the same 1. Ticked on staging,
    // routes 1 and 2 arrived ticked on production, with a Delete (2) nobody
    // had asked for there.
    expect(selectionOf({ listKey: PAGE_1, ids: ['1', '2'] }, PROD, ['1', '2', '3'])).toEqual([]);
  });

  it('drops a row that is no longer on the list', () => {
    // b was deleted from its own menu: a batch that still held it sent a
    // DELETE for something no longer there.
    expect(selectionOf({ listKey: PAGE_1, ids: ['a', 'b'] }, PAGE_1, ['a', 'c'])).toEqual(['a']);
  });

  it('is nothing on an empty list, and nothing when nothing was ticked', () => {
    expect(selectionOf({ listKey: PAGE_1, ids: ['a'] }, PAGE_1, [])).toEqual([]);
    expect(selectionOf({ listKey: PAGE_1, ids: [] }, PAGE_1, ['a'])).toEqual([]);
  });
});

describe('a change of selection', () => {
  it('replaces it', () => {
    expect(tickedAfter({ listKey: PAGE_2, ids: ['k'] }, PAGE_2, ['k', 'l'], ['l'])).toEqual({
      listKey: PAGE_2,
      ids: ['l'],
    });
  });

  it('given as a function, starts from what this list shows as selected', () => {
    // Two toggles before a render each see the one before them.
    const one = tickedAfter({ listKey: PAGE_1, ids: [] }, PAGE_1, ['a', 'b'], (s) => [...s, 'a']);
    const two = tickedAfter(one, PAGE_1, ['a', 'b'], (s) => [...s, 'b']);
    expect(two.ids).toEqual(['a', 'b']);

    // And not a row that has left the list since it was ticked.
    const after = tickedAfter({ listKey: PAGE_1, ids: ['a', 'gone'] }, PAGE_1, ['a', 'b'], (s) => [
      ...s,
      'b',
    ]);
    expect(after.ids).toEqual(['a', 'b']);
  });

  it('made for another list changes nothing', () => {
    // A batch confirmed on page one, answered once page two is shown and
    // ticked: its "clear the selection" is page one's, and wiped page two's.
    const onPageTwo = { listKey: PAGE_2, ids: ['k'] };
    expect(tickedAfter(onPageTwo, PAGE_1, ['a', 'b'], [])).toBe(onPageTwo);
    expect(tickedAfter(onPageTwo, PAGE_1, ['a', 'b'], (s) => [...s, 'a'])).toBe(onPageTwo);
  });
});
