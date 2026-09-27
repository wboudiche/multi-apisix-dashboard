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
import {
  globalRoleLabel,
  INSTANCE_ROLES,
  roleColor,
  roleLabel,
} from './role-labels';

const KNOWN = ['super_admin', 'instance_admin', 'developer', 'viewer'];

/** Hands back whatever key was asked for, so a test can read it. */
const echo = ((key: string) => key) as unknown as TFunction;

/** The translation, resolved the way i18next resolves a dotted key. */
const resolve = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      en
    );

// These keys reach i18next through a variable, so eslint's no-unknown-key
// cannot check them: a rename of the block would ship "roles.superAdmin" into
// the badge with a green lint and a green test suite.
describe('the role names reach i18n', () => {
  it.each(KNOWN)('%s is named by a key en/common.json holds', (role) => {
    expect(resolve(roleLabel(echo, role))).toEqual(expect.any(String));
  });

  it('an account with no global role is named too', () => {
    expect(resolve(globalRoleLabel(echo, ''))).toEqual(expect.any(String));
  });

  it.each([...INSTANCE_ROLES])('the form offers %s by name', (role) => {
    expect(resolve(roleLabel(echo, role))).toEqual(expect.any(String));
  });
});

describe('roleLabel', () => {
  it.each([
    ['super_admin', 'roles.superAdmin'],
    ['instance_admin', 'roles.instanceAdmin'],
    ['developer', 'roles.developer'],
    ['viewer', 'roles.viewer'],
  ])('translates %s', (role, key) => {
    expect(roleLabel(echo, role)).toBe(key);
  });

  it('shows a role it does not know rather than naming it', () => {
    // Not called a plain account: a role nobody here has heard of may well be
    // allowed more than a user is.
    expect(roleLabel(echo, 'audit_reader')).toBe('audit reader');
  });

  it.each([['empty', ''], ['missing', undefined], ['null', null]])(
    'says nothing for a role that is %s',
    (_name, role) => {
      // On a per-instance assignment an empty role means no role on that
      // instance. Naming it would claim an access the account does not hold.
      expect(roleLabel(echo, role)).toBe('');
    }
  );

  it('is not fooled by a property every object has', () => {
    expect(roleLabel(echo, 'toString')).toBe('toString');
    expect(roleLabel(echo, 'constructor')).toBe('constructor');
    expect(roleColor('toString')).toBe('gray');
  });
});

describe('globalRoleLabel', () => {
  it('names an account that holds no global role', () => {
    // Most accounts: their access comes from their per-instance assignments,
    // and the column showed them a badge with a shield and no text.
    expect(globalRoleLabel(echo, '')).toBe('roles.user');
    expect(globalRoleLabel(echo, undefined)).toBe('roles.user');
  });

  it('names the ones that do', () => {
    expect(globalRoleLabel(echo, 'super_admin')).toBe('roles.superAdmin');
  });
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
