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

/**
 * The rules a password can break, by the code the backend names each with,
 * and the number its sentence needs - `min` for the shortest, `max` for the
 * longest, none for the others.
 */
const RULES = {
  min_length: { key: 'passwordRules.min_length', param: 'min' },
  max_length: { key: 'passwordRules.max_length', param: 'max' },
  missing_uppercase: { key: 'passwordRules.missing_uppercase', param: undefined },
  missing_lowercase: { key: 'passwordRules.missing_lowercase', param: undefined },
  missing_digit: { key: 'passwordRules.missing_digit', param: undefined },
  missing_symbol: { key: 'passwordRules.missing_symbol', param: undefined },
} as const;

const known = (code: unknown): code is keyof typeof RULES =>
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(RULES, code);

/**
 * One rule in the reader's words, or nothing when the answer does not carry
 * the number the sentence needs: "Be at least {{min}} characters" is not one
 * to show. Only that number is read out of `params` - what the backend sends
 * is not handed to i18next as its options.
 */
const ruleText = (t: TFunction, violation: PolicyViolation | undefined) => {
  if (!known(violation?.code)) return undefined;
  const { key, param } = RULES[violation.code];
  if (param === undefined) return t(key);
  const value = violation.params?.[param];
  return typeof value === 'number' ? t(key, { [param]: value }) : undefined;
};

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
  const rules = violations.flatMap((violation) => ruleText(t, violation) ?? []);
  return rules.length > 0 ? t('passwordRules.unmet', { rules: rules.join('; ') }) : undefined;
};
