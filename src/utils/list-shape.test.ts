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

import { parseRecordList } from '@/utils/list-shape';

/**
 * axios resolves any 2xx, so a proxy that answers /api/* with the SPA's own
 * index.html arrives at these callers as a successful response. Every consumer
 * then treats it as the list it asked for: a string has a length, so it reads
 * as N entries, and the first .map or .some over it throws — which for
 * InstanceGuard means the whole dashboard (#153).
 *
 * Checked once here rather than at each consumer. #150 hardened the header,
 * #153 the guard, and the crash simply moved to the instances page one click
 * away; there is no number of consumers at which that converges.
 */
describe('parseRecordList', () => {
  it('returns the very same array it was given', () => {
    // toBe, not toEqual: these feed jotai atoms and react-query caches, where
    // a fresh array on every call is a re-render on every call.
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(parseRecordList(list)).toBe(list);
  });

  it('refuses anything that is not a list, rather than calling it empty', () => {
    // Returning [] here would trade a crash for a silent lie: "there are no
    // instances" and "the response was unreadable" would look identical, and
    // the header would stop telling the operator which one it hit (#150).
    for (const notAList of ['<!doctype html><html></html>', { total: 0 }, null, undefined]) {
      expect(() => parseRecordList(notAList)).toThrow(/expected a list/i);
    }
  });

  it('refuses a list holding something that is not a record', () => {
    // Dropping the odd entry quietly would be the same lie one level down, and
    // one of these lists is an authorization list: getUserInstances feeds
    // usePermission, which falls back to the broader global role when the
    // per-instance record is missing. A dropped entry would widen what someone
    // may do, without a word.
    for (const bad of [[null], [{ id: 'a' }, 'x'], [{ id: 'a' }, 1]]) {
      expect(() => parseRecordList(bad)).toThrow(/expected a list of records/i);
    }
  });

  it('does not mistake an array for a record', () => {
    // typeof [] === 'object', so a nested-array payload passed the record
    // check and read as two instances whose ids were both undefined.
    expect(() => parseRecordList([[], []])).toThrow(/expected a list of records/i);
  });

});
