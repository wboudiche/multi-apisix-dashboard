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
import axios from 'axios';
import type { TFunction } from 'i18next';

import type { PolicyViolation } from '@/apis/policy';

/** The rules a password can break, by the code the backend names each with. */
const RULES = {
  min_length: 'passwordRules.min_length',
  max_length: 'passwordRules.max_length',
  missing_uppercase: 'passwordRules.missing_uppercase',
  missing_lowercase: 'passwordRules.missing_lowercase',
  missing_digit: 'passwordRules.missing_digit',
  missing_symbol: 'passwordRules.missing_symbol',
} as const;

const known = (code: string): code is keyof typeof RULES =>
  Object.prototype.hasOwnProperty.call(RULES, code);

/**
 * What a refused password broke, in the reader's language.
 *
 * The backend answers a password the policy refuses with the rules it broke -
 * `violations`, each a code and its numbers - beside one English sentence that
 * names none of them. Nothing read the rules: the screens showed the sentence,
 * or a sentence of their own that said no more (#364).
 *
 * Undefined when the failure is not that refusal, or names no rule this build
 * knows: the caller says what it said before.
 */
export const policyRefusal = (t: TFunction, error: unknown): string | undefined => {
  if (!axios.isAxiosError(error) || error.response?.status !== 422) return undefined;
  const violations = (error.response.data as { violations?: PolicyViolation[] } | undefined)
    ?.violations;
  if (!Array.isArray(violations)) return undefined;
  const rules = violations.flatMap((violation) =>
    typeof violation?.code === 'string' && known(violation.code)
      ? [t(RULES[violation.code], violation.params ?? {})]
      : []
  );
  return rules.length > 0 ? t('passwordRules.unmet', { rules: rules.join('; ') }) : undefined;
};
