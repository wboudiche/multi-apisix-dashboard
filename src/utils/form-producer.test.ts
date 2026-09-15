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

import { produceCleanEmpty } from './form-producer';
import { pipeProduce } from './producer';

type Body = Record<string, unknown>;

const cleanEmpty = produceCleanEmpty as (value: Body) => Body;

describe('produceCleanEmpty', () => {
  it('drops empty strings, empty arrays and objects left empty', () => {
    expect(
      cleanEmpty({ name: 's', desc: '', hosts: [], upstream: { key: '' } })
    ).toEqual({ name: 's' });
  });

  // typeof null === 'object', so an unguarded recursion walks into
  // Object.keys(null) and throws, and the service add form runs this on submit.
  it('does not throw on a null, top-level or nested', () => {
    expect(cleanEmpty({ name: 's', desc: null, upstream: { key: null } })).toEqual(
      { name: 's', desc: null, upstream: { key: null } }
    );
  });

  it('lets the service add pipeline drop the null instead of throwing', () => {
    // The same pipeline the service add page sends its values through.
    const produceService = pipeProduce(produceCleanEmpty) as (value: Body) => Body;

    expect(produceService({ name: 's', desc: null })).toEqual({ name: 's' });
  });
});
