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

/**
 * What a role is called, and the colour that tells one apart at a glance.
 *
 * The Users page rendered the stored value instead - `role.replace('_', ' ')`,
 * untranslated in every language - and switched over the same four strings in
 * a second place to pick the badge colour. Adding a role meant remembering
 * both (#300).
 */
const ROLES = {
  super_admin: { labelKey: 'roles.superAdmin', color: 'red' },
  instance_admin: { labelKey: 'roles.instanceAdmin', color: 'orange' },
  developer: { labelKey: 'roles.developer', color: 'blue' },
  viewer: { labelKey: 'roles.viewer', color: 'gray' },
} as const;

/** The roles this build knows. Exported so a caller that names one - a spec,
 *  say - names it at compile time rather than at assertion time. */
export type KnownRole = keyof typeof ROLES;

// Own properties only: every object answers to 'toString' and 'constructor',
// and a role is a string that arrives from a record in etcd.
const known = (role?: string | null): KnownRole | undefined =>
  typeof role === 'string' && Object.prototype.hasOwnProperty.call(ROLES, role)
    ? (role as KnownRole)
    : undefined;

/**
 * The i18n key naming a role, or undefined for anything this build does not
 * know - including the empty value.
 *
 * Empty means different things in the two places a role is stored, and neither
 * is a name: no global role at all on a `User`, and no role on this instance on
 * a `UserInstance`. Hence `globalRoleLabel` for the first and a plain
 * `roleLabel` for the second, rather than one name for both - calling an
 * account "User" where it holds no access would claim one it does not have.
 */
const roleLabelKey = (role?: string | null) => {
  const r = known(role);
  return r ? ROLES[r].labelKey : undefined;
};

/** The badge colour for a role; neutral for one this build does not know. */
export const roleColor = (role?: string | null) => {
  const r = known(role);
  return r ? ROLES[r].color : 'gray';
};

/**
 * A role as an operator should read it: translated where this build knows the
 * role, and otherwise the stored value with its underscores loosened - a role
 * nobody here has heard of is shown rather than named, because it may well be
 * allowed more than a plain account is.
 *
 * Empty in, empty out: on a per-instance assignment that means no role on that
 * instance, which is not something to put a word to.
 */
export const roleLabel = (t: TFunction, role?: string | null) => {
  const key = roleLabelKey(role);
  return key ? t(key) : (role ?? '').replace(/_/g, ' ');
};

/**
 * A global role as the Users page shows it.
 *
 * No global role is not a missing name: it is an account whose access comes
 * from its per-instance assignments, which is most of them. The column showed
 * every one of them a badge with a shield and no text (#300).
 */
export const globalRoleLabel = (t: TFunction, role?: string | null) =>
  role ? roleLabel(t, role) : t('roles.user');

/**
 * The roles that can be held on one instance, in the order the form offers
 * them. The order is a choice, the names are checked against the catalogue:
 * the select used to list them again by hand, and nothing tied the two lists
 * together.
 */
export const INSTANCE_ROLES = [
  'instance_admin',
  'developer',
  'viewer',
] as const satisfies readonly KnownRole[];
