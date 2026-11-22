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
import type { Role } from '@/hooks/usePermission';

export type SettingsTab = 'password-policy' | 'identity-providers' | 'oidc-clients';

/**
 * The tabs of the settings page a role gets, in order. The password policy and
 * the connections are the super admin's; the OIDC clients of the current
 * instance are also an admin of that instance's.
 */
export const settingsTabsFor = (role: Role | undefined): SettingsTab[] => {
  if (role === 'super_admin') return ['password-policy', 'identity-providers', 'oidc-clients'];
  if (role === 'instance_admin') return ['oidc-clients'];
  return [];
};
