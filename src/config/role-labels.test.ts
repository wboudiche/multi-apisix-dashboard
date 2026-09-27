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
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from '../locales/en/common.json';
import { roleColor, roleLabel, roleLabelKey } from './role-labels';

const KNOWN = ['super_admin', 'instance_admin', 'developer', 'viewer'];

/** The translation, as i18next would resolve the dotted key. */
const resolve = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      en
    );

// t() is called with a variable here, so eslint's no-unknown-key cannot check
// these keys and a rename of the block would ship "roles.superAdmin" into the
// badge with a green lint.
describe('the role names reach i18n', () => {
  it.each(KNOWN)('%s has a key en/common.json holds', (role) => {
    const key = roleLabelKey(role);
    expect(key).toBeDefined();
    expect(resolve(key!)).toEqual(expect.any(String));
  });

  it('an account with no global role has one too', () => {
    // Used by the Users page for the empty global role.
    expect(resolve('roles.user')).toEqual(expect.any(String));
  });
});

describe('roleLabelKey', () => {
  it.each([
    ['super_admin', 'roles.superAdmin'],
    ['instance_admin', 'roles.instanceAdmin'],
    ['developer', 'roles.developer'],
    ['viewer', 'roles.viewer'],
  ])('names %s', (role, key) => {
    expect(roleLabelKey(role)).toBe(key);
  });

  it.each([['empty', ''], ['missing', undefined], ['null', null]])(
    'has no name for a role that is %s',
    (_name, role) => {
      // Empty means "no global role" on a User and "no role on this instance"
      // on a UserInstance. Neither is a name, and calling both "User" would
      // claim an access the second one does not hold.
      expect(roleLabelKey(role)).toBeUndefined();
    }
  );

  it('has no name for a role it does not know', () => {
    expect(roleLabelKey('auditor')).toBeUndefined();
  });

  it('is not fooled by a property every object has', () => {
    expect(roleLabelKey('toString')).toBeUndefined();
    expect(roleLabelKey('constructor')).toBeUndefined();
    expect(roleColor('toString')).toBe('gray');
  });
});

describe('roleLabel', () => {
  const t = ((key: string) => `translated:${key}`) as unknown as TFunction;

  it('translates a role it knows', () => {
    expect(roleLabel(t, 'developer')).toBe('translated:roles.developer');
  });

  it('shows a role it does not know as it came', () => {
    // Rather than as a plain account: a role nobody here has heard of may well
    // be allowed more than a user is.
    expect(roleLabel(t, 'audit_reader')).toBe('audit reader');
  });

  it.each([['', ''], [undefined, ''], [null, '']])(
    'says nothing for %s',
    (role, expected) => {
      expect(roleLabel(t, role)).toBe(expected);
    }
  );
});

describe('roleColor', () => {
  it.each([
    ['super_admin', 'red'],
    ['instance_admin', 'orange'],
    ['developer', 'blue'],
    ['viewer', 'gray'],
  ])('%s is %s', (role, color) => {
    expect(roleColor(role)).toBe(color);
  });

  it.each([[''], ['auditor'], [undefined]])('is neutral for %s', (role) => {
    expect(roleColor(role)).toBe('gray');
  });
});
