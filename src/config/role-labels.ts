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

/**
 * The i18n key that names a role.
 *
 * The Users page rendered the stored value instead: `role.replace('_', ' ')`,
 * untranslated in every language, and an empty string for the accounts that
 * hold no global role at all - a badge with a shield and no text, in the
 * column that exists to tell a super admin from everyone else (#300).
 *
 * An account whose access comes from its per-instance assignments carries no
 * global role, so the empty role has a name of its own here. A role this build
 * does not know gets no key: the caller shows it as it came, because labelling
 * it "User" would understate what it may do.
 */
export const roleLabelKey = (role?: string | null) => {
  switch (role) {
    case 'super_admin':
      return 'roles.superAdmin' as const;
    case 'instance_admin':
      return 'roles.instanceAdmin' as const;
    case 'developer':
      return 'roles.developer' as const;
    case 'viewer':
      return 'roles.viewer' as const;
    case '':
    case null:
    case undefined:
      return 'roles.user' as const;
    default:
      return undefined;
  }
};
