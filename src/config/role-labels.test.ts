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
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { defaultNS, resources } from './i18n';
import { globalRoleLabel, INSTANCE_ROLES, roleColor, roleLabel } from './role-labels';

/**
 * The words, not the keys.
 *
 * A real i18next does the resolving, so a key the locale does not hold fails
 * these tests by coming back as itself - which is what i18next renders, and
 * what eslint cannot check for a key passed as a variable.
 */
const i18n = i18next.createInstance();
void i18n.init({ lng: 'en', defaultNS, resources });
const t = i18n.t;

describe('roleLabel', () => {
  // Against the bundle's own value, not against the words written out here:
  // this is about which key a role reaches, and rewording a label in
  // en/common.json is not a thing that should break six assertions.
  it.each([
    ['super_admin', 'roles.superAdmin'],
    ['instance_admin', 'roles.instanceAdmin'],
    ['developer', 'roles.developer'],
    ['viewer', 'roles.viewer'],
    // as const, so the key stays a literal: t() takes the keys en holds, not
    // any string.
  ] as const)('names %s', (role, key) => {
    expect(roleLabel(t, role)).toBe(t(key));
    expect(roleLabel(t, role)).not.toContain('roles.');
  });

  it('shows a role it does not know rather than naming it', () => {
    // Not called a plain account: a role nobody here has heard of may well be
    // allowed more than a user is.
    expect(roleLabel(t, 'audit_reader')).toBe('audit reader');
  });

  it.each([['empty', ''], ['missing', undefined], ['null', null]])(
    'says nothing for a role that is %s',
    (_name, role) => {
      // On a per-instance assignment an empty role means no role on that
      // instance. Naming it would claim an access the account does not hold.
      expect(roleLabel(t, role)).toBe('');
    }
  );

  it('is not fooled by a property every object has', () => {
    expect(roleLabel(t, 'toString')).toBe('toString');
    expect(roleLabel(t, 'constructor')).toBe('constructor');
    expect(roleColor('toString')).toBe('gray');
  });
});

describe('globalRoleLabel', () => {
  it('names an account that holds no global role', () => {
    // Most accounts: their access comes from their per-instance assignments,
    // and the column showed them a badge with a shield and no text (#300).
    expect(globalRoleLabel(t, '')).toBe(t('roles.user'));
    expect(globalRoleLabel(t, '')).not.toContain('roles.');
    expect(globalRoleLabel(t, undefined)).toBe(t('roles.user'));
  });

  it('names the ones that do', () => {
    expect(globalRoleLabel(t, 'super_admin')).toBe(t('roles.superAdmin'));
  });
});

describe('INSTANCE_ROLES', () => {
  it('is the roles the form offers, in the order it offers them', () => {
    expect([...INSTANCE_ROLES]).toEqual(['instance_admin', 'developer', 'viewer']);
  });

  it.each([...INSTANCE_ROLES])('%s has a name', (role) => {
    // A key the locale lost would come back as "roles.developer".
    expect(roleLabel(t, role)).not.toContain('roles.');
    expect(roleLabel(t, role)).not.toBe('');
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
