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
import { Alert } from '@mantine/core';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import IconWarning from '~icons/material-symbols/warning-outline';

type ListWarningBannerProps = {
  /**
   * The `__warning` code the proxy attached to a list response, or nothing.
   *
   * It means the list arrived complete as far as the gateway was asked, but
   * something the filter depended on could not be read — so what is on screen
   * is narrower than the truth. The rows are still worth showing; what must not
   * happen is the shorter list passing for the whole one.
   *
   * A code rather than a sentence, so the text is translated here. The backend
   * knows which part it could not read; it does not know what language the
   * person reading it uses.
   */
  warning?: string;
};

/**
 * The codes the proxy can send, mapped to what they say.
 *
 * Spelled out rather than built from the code, because the i18n catalogue is
 * typed: a key assembled at runtime is not one the compiler can check, and a
 * typo would surface as a missing string rather than a build failure.
 */
const WARNING_MESSAGES = {
  service_lookup_failed: 'listWarning.service_lookup_failed',
} as const;

export const ListWarningBanner: FC<ListWarningBannerProps> = ({ warning }) => {
  const { t } = useTranslation();

  if (!warning) return null;

  return (
    <Alert
      icon={<IconWarning width="18" height="18" />}
      title={t('listWarning.title')}
      color="yellow"
      variant="light"
      mb="md"
    >
      {/* An unrecognised code still has to read as something: a newer backend
          may name a caveat this build has never heard of. */}
      {t(WARNING_MESSAGES[warning as keyof typeof WARNING_MESSAGES] ?? 'listWarning.unknown')}
    </Alert>
  );
};
