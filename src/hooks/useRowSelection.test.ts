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

import { visibleSelection } from './useRowSelection';

// Batch Delete was handed every id ever ticked on the page, whatever it was
// showing by then, and deleted routes nobody could see (#371).
describe('the selection of a list page', () => {
  it('is what was ticked, while it is on screen', () => {
    expect(visibleSelection(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a']);
  });

  it('is not what was ticked on another page', () => {
    // Page two: a and b were ticked on page one.
    expect(visibleSelection(['a', 'b'], ['k', 'l', 'm'])).toEqual([]);
  });

  it('keeps what is still shown when a filter takes rows away', () => {
    expect(visibleSelection(['a', 'b', 'c'], ['b'])).toEqual(['b']);
  });

  it('drops a row that was deleted from its own menu', () => {
    // b is gone from the list: a batch delete that still held it sent a
    // DELETE for something no longer there, and failed.
    expect(visibleSelection(['a', 'b'], ['a', 'c'])).toEqual(['a']);
  });

  it('is nothing on an empty list, and nothing when nothing was ticked', () => {
    expect(visibleSelection(['a'], [])).toEqual([]);
    expect(visibleSelection([], ['a'])).toEqual([]);
  });
});
