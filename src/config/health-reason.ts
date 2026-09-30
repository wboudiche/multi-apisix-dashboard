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

import type { InstanceHealth } from '@/apis/instances';

/**
 * Why a gateway is not Connected, in the reader's language.
 *
 * The backend sends the reason as a code rather than a sentence, because an
 * English sentence written in Go reached every reader in English, inside a
 * tooltip the rest of which was translated (#340). The probe's own error comes
 * as well for a super_admin, and wins: it is the detail that says what to fix,
 * and a raw error is data rather than prose.
 *
 * A code this build does not know gives no reason rather than a guess, and the
 * caller falls back on the status alone.
 */
export const healthReason = (
  t: TFunction,
  health?: Pick<InstanceHealth, 'code' | 'error'>
): string | undefined => {
  if (health?.error) return health.error;
  switch (health?.code) {
    case 'unreachable':
      return t('instances.healthReason.unreachable');
    case 'not_read':
      return t('instances.healthReason.notRead');
    case 'unreadable':
      return t('instances.healthReason.unreadable');
    default:
      return undefined;
  }
};
