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

import { recordDate } from './record-date';

describe('recordDate', () => {
  it('formats a date the record carries', () => {
    const value = '2026-09-27T14:05:00Z';
    expect(recordDate(value)).toBe(new Date(value).toLocaleDateString());
  });

  it('reads Go zero time as unknown, rather than as the year 1', () => {
    // What every user record held until the backend stamped its dates (#300).
    expect(recordDate('0001-01-01T00:00:00Z')).toBeUndefined();
  });

  it.each([
    ['0001-01-01T00:00:00+01:00'],
    ['0001-01-01T12:00:00-05:00'],
  ])('reads the zero time as unknown whatever offset it carries: %s', (value) => {
    expect(recordDate(value)).toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['not a date', 'whenever'],
    ['not a string', 42 as unknown as string],
  ])('is unknown for %s', (_name, value) => {
    expect(recordDate(value)).toBeUndefined();
  });
});
