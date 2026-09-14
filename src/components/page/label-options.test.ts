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
import { describe, expect, it } from 'vitest';

import type { LabelTaxonomy } from '@/apis/labels';

import { labelOptions } from './label-options';

const entry = (key: string, values: string[], displayName = ''): LabelTaxonomy => ({
  key,
  display_name: displayName,
  color: 'blue',
  values,
  created_by: '',
  created_at: 0,
  updated_at: 0,
});

describe('the labels the filter offers', () => {
  it('are the catalogue, in its own order, when no route carries any', () => {
    expect(labelOptions([entry('team', ['a']), entry('env', ['prod'], 'Environment')], [])).toEqual([
      { key: 'team', label: 'team', values: ['a'] },
      { key: 'env', label: 'Environment', values: ['prod'] },
    ]);
  });

  it('include what the routes carry that the catalogue does not', () => {
    // A catalogue entry removed while routes still carry it, or labels written
    // before the catalogue knew them: they are on screen in the table, and
    // could not be filtered by (#190).
    expect(
      labelOptions([], [{ 'soap-service': 'BillingService', 'wsdl-source-hash': '4539336e' }])
    ).toEqual([
      { key: 'soap-service', label: 'soap-service', values: ['BillingService'] },
      { key: 'wsdl-source-hash', label: 'wsdl-source-hash', values: ['4539336e'] },
    ]);
  });

  it('merge a key and its values the way the proxy compares them, ignoring case', () => {
    // The proxy matches labels case-insensitively, so ENV:Prod and env:prod are
    // one filter; offering both would only look like two.
    expect(
      labelOptions(
        [entry('env', ['prod'], 'Environment')],
        [{ ENV: 'PROD' }, { env: 'staging' }, { Env: 'Staging' }]
      )
    ).toEqual([{ key: 'env', label: 'Environment', values: ['prod', 'staging'] }]);
  });

  it('put the catalogue first and the rest after it, sorted', () => {
    expect(
      labelOptions([entry('zone', ['eu'])], [{ beta: 'x' }, { alpha: 'y' }, { zone: 'us' }])
    ).toEqual([
      { key: 'zone', label: 'zone', values: ['eu', 'us'] },
      { key: 'alpha', label: 'alpha', values: ['y'] },
      { key: 'beta', label: 'beta', values: ['x'] },
    ]);
  });

  it('take a catalogue entry that has no values, as the backend sends it', () => {
    // The backend accepts an entry with no values and sends them as null. The
    // filter used to fall back to an empty list for that; spreading it threw
    // while the routes page rendered.
    const noValues = { ...entry('env', []), values: null as unknown as string[] };
    expect(labelOptions([noValues], [{ env: 'prod' }])).toEqual([
      { key: 'env', label: 'env', values: ['prod'] },
    ]);
  });

  it('pass over routes that carry no labels', () => {
    expect(labelOptions([], [undefined, {}, { team: 'a' }])).toEqual([
      { key: 'team', label: 'team', values: ['a'] },
    ]);
  });
});
