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

import { IdAsName } from './common';

const error = (id: string) => IdAsName.safeParse({ id }).error?.issues[0]?.message;

describe('an ID that is a record\'s only name', () => {
  it('takes the characters the gateway\'s id pattern allows', () => {
    for (const id of ['cors-global', 'vault.prod', 'rate_limit_2', 'a'.repeat(64)]) {
      expect(error(id)).toBeUndefined();
    }
  });

  it('asks for one when none is given', () => {
    expect(error('')).toBe('form.validation.nameRequired');
  });

  it('refuses a space, a slash, a percent sign, or more than 64', () => {
    for (const id of ['has space', 'a/b', 'a%2Fb', 'a'.repeat(65)]) {
      expect(error(id)).toBe('form.validation.idAsName');
    }
  });

  it('refuses the dot segments a browser resolves out of a path', () => {
    expect(error('.')).toBe('form.validation.idAsName');
    expect(error('..')).toBe('form.validation.idAsName');
    expect(error('...')).toBeUndefined();
  });
});
