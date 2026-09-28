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
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { probeLimitKey } from './api-error';

/** A rejection as axios raises it, with the body the backend answered. */
const refusal = (status: number, data: unknown) => {
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST');
  error.response = {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return error;
};

describe('probeLimitKey', () => {
  it('names the refusal that is about this account', () => {
    expect(probeLimitKey(refusal(429, { code: 'probe_limit_caller' }))).toBe(
      'error.probeBusyCaller'
    );
  });

  it('names the refusal that is about the dashboard', () => {
    expect(probeLimitKey(refusal(429, { code: 'probe_limit_all' }))).toBe('error.probeBusy');
  });

  it('reads a 429 that names nothing as the dashboard being busy', () => {
    // What a backend older than #331 answers: the refusal had no name then.
    expect(probeLimitKey(refusal(429, { error: 'busy' }))).toBe('error.probeBusy');
    expect(probeLimitKey(refusal(429, undefined))).toBe('error.probeBusy');
  });

  it.each([403, 400, 502, 200])('is not a ceiling at %i', (status) => {
    expect(probeLimitKey(refusal(status, { code: 'probe_limit_caller' }))).toBeUndefined();
  });

  it('is not a ceiling when the failure is not an axios one', () => {
    expect(probeLimitKey(new Error('offline'))).toBeUndefined();
    expect(probeLimitKey(undefined)).toBeUndefined();
  });

  it('agrees with axios about what a rejection is', () => {
    // Guards the helper's own premise: built any other way, every case above
    // would fall through to undefined and say nothing.
    expect(axios.isAxiosError(refusal(429, {}))).toBe(true);
  });
});
