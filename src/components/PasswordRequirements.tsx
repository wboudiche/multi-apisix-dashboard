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
import { List, ThemeIcon } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { policyApi } from '@/apis/policy';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconDot from '~icons/material-symbols/radio-button-unchecked';

const hasUpper = (s: string) => /[A-Z]/.test(s);
const hasLower = (s: string) => /[a-z]/.test(s);
const hasDigit = (s: string) => /[0-9]/.test(s);
const hasSymbol = (s: string) => /[^A-Za-z0-9]/.test(s);

export const PasswordRequirements = ({ password }: { password: string }) => {
  const { t } = useTranslation();
  const { data: policy } = useQuery({ queryKey: ['password-policy'], queryFn: policyApi.get });
  if (!policy) return null;

  const rules: { ok: boolean; text: string }[] = [
    { ok: password.length >= policy.min_length, text: t('passwordRules.min_length', { min: policy.min_length }) },
    ...(policy.require_uppercase ? [{ ok: hasUpper(password), text: t('passwordRules.missing_uppercase') }] : []),
    ...(policy.require_lowercase ? [{ ok: hasLower(password), text: t('passwordRules.missing_lowercase') }] : []),
    ...(policy.require_digit ? [{ ok: hasDigit(password), text: t('passwordRules.missing_digit') }] : []),
    ...(policy.require_symbol ? [{ ok: hasSymbol(password), text: t('passwordRules.missing_symbol') }] : []),
  ];

  return (
    <List spacing={4} size="sm" center>
      {rules.map((r) => (
        <List.Item
          key={r.text}
          data-met={r.ok ? 'true' : 'false'}
          icon={
            <ThemeIcon color={r.ok ? 'green' : 'gray'} size={18} radius="xl" variant="light">
              {r.ok ? <IconCheck width={14} height={14} /> : <IconDot width={14} height={14} />}
            </ThemeIcon>
          }
        >
          {r.text}
        </List.Item>
      ))}
    </List>
  );
};
