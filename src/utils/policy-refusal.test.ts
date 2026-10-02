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
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import i18n from '@/config/i18n';

import { policyRefusal } from './policy-refusal';

const refused = (status: number, data: unknown) =>
  new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
  } as AxiosResponse);

const t = i18n.t.bind(i18n);

// The backend names the rules a password broke; the screens showed its one
// sentence for all of them, in English (#364).
describe('a refused password', () => {
  it('names the rules it broke, with their numbers', () => {
    const error = refused(422, {
      error: 'Password does not meet policy',
      violations: [{ code: 'max_length', params: { max: 72 } }, { code: 'missing_digit' }],
    });

    expect(policyRefusal(t, error)).toBe(
      `The password must: ${t('passwordRules.max_length', { max: 72 })}; Contain a digit`
    );
  });

  it('leaves out a rule this build does not know, and says the others', () => {
    const error = refused(422, {
      violations: [{ code: 'reused' }, { code: 'min_length', params: { min: 12 } }],
    });

    expect(policyRefusal(t, error)).toBe('The password must: Be at least 12 characters');
  });

  it('is not one when it names no rule this build knows', () => {
    expect(policyRefusal(t, refused(422, { violations: [{ code: 'reused' }] }))).toBeUndefined();
    expect(policyRefusal(t, refused(422, { error: 'Password does not meet policy' }))).toBeUndefined();
    expect(policyRefusal(t, refused(422, { violations: 'none' }))).toBeUndefined();
  });

  it('leaves out a rule that came without its number, rather than show a placeholder', () => {
    const error = refused(422, {
      violations: [{ code: 'min_length' }, { code: 'max_length', params: { max: '72' } }, { code: 'missing_symbol' }],
    });

    expect(policyRefusal(t, error)).toBe('The password must: Contain a symbol');
  });

  it('reads the number a rule needs and nothing else the answer carries', () => {
    const error = refused(422, {
      violations: [{ code: 'min_length', params: { min: 12, lng: 'de', defaultValue: 'x' } }],
    });

    expect(policyRefusal(t, error)).toBe('The password must: Be at least 12 characters');
  });

  it('is not one for another failure', () => {
    const error = refused(400, { violations: [{ code: 'missing_digit' }] });

    expect(policyRefusal(t, error)).toBeUndefined();
    expect(policyRefusal(t, new Error('offline'))).toBeUndefined();
  });
});
