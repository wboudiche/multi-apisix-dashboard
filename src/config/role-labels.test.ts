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

import { roleLabelKey } from './role-labels';

describe('roleLabelKey', () => {
  it.each([
    ['super_admin', 'roles.superAdmin'],
    ['instance_admin', 'roles.instanceAdmin'],
    ['developer', 'roles.developer'],
    ['viewer', 'roles.viewer'],
  ])('names %s', (role, key) => {
    expect(roleLabelKey(role)).toBe(key);
  });

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['null', null],
  ])('names an account with no global role (%s)', (_name, role) => {
    // These are the plain accounts, whose access comes from their per-instance
    // assignments. The column showed them a blank badge.
    expect(roleLabelKey(role)).toBe('roles.user');
  });

  it('has no key for a role it does not know', () => {
    // Shown as it came rather than called a plain account: a role this build
    // has never heard of may well be allowed more than a user is.
    expect(roleLabelKey('auditor')).toBeUndefined();
  });

  it('is not fooled by a property every object has', () => {
    expect(roleLabelKey('toString')).toBeUndefined();
    expect(roleLabelKey('constructor')).toBeUndefined();
  });
});
