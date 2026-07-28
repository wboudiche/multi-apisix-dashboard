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

import { pipeProduce } from './producer';

type Body = Record<string, unknown> & { plugins?: Record<string, unknown> };

// pipeProduce is what every resource form runs its values through on the way to
// the Admin API, so anything it drops silently never reaches APISIX.
const produceBody = pipeProduce() as (value: Body) => Body;

describe('pipeProduce', () => {
  it('keeps a plugin whose configuration is empty', () => {
    // `{"key-auth": {}}` enables the plugin with its defaults — an empty config
    // is the normal way to switch on most auth plugins, not leftover noise.
    const result = produceBody({
      name: 'r',
      uri: '/r',
      plugins: { 'key-auth': {} },
    });

    expect(result.plugins).toEqual({ 'key-auth': {} });
  });

  it('keeps empty-config plugins alongside configured ones', () => {
    const result = produceBody({
      name: 'r',
      uri: '/r',
      plugins: {
        'key-auth': {},
        'basic-auth': { hide_credentials: false },
      },
    });

    expect(Object.keys(result.plugins!).sort()).toEqual(['basic-auth', 'key-auth']);
    expect(result.plugins!['basic-auth']).toEqual({ hide_credentials: false });
  });

  it('keeps several empty-config plugins at once', () => {
    const result = produceBody({
      name: 'r',
      plugins: { 'key-auth': {}, 'basic-auth': {}, 'jwt-auth': {} },
    });

    expect(Object.keys(result.plugins!).sort()).toEqual([
      'basic-auth',
      'jwt-auth',
      'key-auth',
    ]);
  });

  it('still strips empty values elsewhere in the payload', () => {
    const result = produceBody({
      name: 'r',
      desc: '',
      labels: {},
      plugins: { 'key-auth': {} },
    });

    expect(result.desc).toBeUndefined();
    expect(result.labels).toBeUndefined();
    expect(result.plugins).toEqual({ 'key-auth': {} });
  });

  it('leaves a payload without plugins untouched', () => {
    const result = produceBody({ name: 'r', uri: '/r' });

    expect(result.plugins).toBeUndefined();
    expect(result.name).toBe('r');
  });

  it('still removes the dashboard-only __ keys', () => {
    const result = produceBody({
      name: 'r',
      __team_id: 'team-1',
      plugins: { 'key-auth': {} },
    });

    expect(result.__team_id).toBeUndefined();
    expect(result.plugins).toEqual({ 'key-auth': {} });
  });
});
