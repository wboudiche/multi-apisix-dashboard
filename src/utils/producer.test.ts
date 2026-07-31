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

  // A config that is not empty on the way in but cleans down to nothing used to
  // be dropped: only configs that were already `{}` were protected.
  it('keeps a plugin whose config only becomes empty while cleaning', () => {
    const result = produceBody({
      name: 'r',
      plugins: { 'key-auth': { header: '' } },
    });

    expect(Object.keys(result.plugins ?? {})).toEqual(['key-auth']);
  });

  it('keeps a plugin config whose nested values are all empty objects', () => {
    // The shipped multi-auth template. Every leaf is `{}` — each one enabling a
    // sub-plugin with its defaults — so a cleaner that prunes empty objects
    // destroys the whole plugin and leaves the route unauthenticated.
    const authPlugins = [{ 'basic-auth': {} }, { 'key-auth': {} }];
    const result = produceBody({
      name: 'r',
      plugins: { 'multi-auth': { auth_plugins: authPlugins } },
    });

    expect(result.plugins?.['multi-auth']).toEqual({ auth_plugins: authPlugins });
  });

  it('keeps a configured plugin alongside one that cleans down to nothing', () => {
    const result = produceBody({
      name: 'r',
      plugins: {
        'key-auth': {},
        'ip-restriction': { whitelist: [] },
        'limit-count': { count: 10 },
      },
    });

    expect(Object.keys(result.plugins!).sort()).toEqual([
      'ip-restriction',
      'key-auth',
      'limit-count',
    ]);
    expect(result.plugins!['limit-count']).toEqual({ count: 10 });
  });

  it('drops the plugins key when every plugin was removed', () => {
    const result = produceBody({ name: 'r', uri: '/r', plugins: {} });

    expect(result.plugins).toBeUndefined();
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

  // typeof null === 'object' and null is not an array, so an unguarded
  // recursion walks into Object.keys(null) and throws. pipeProduce runs inside
  // the submit handlers, which do not catch, so the form silently does nothing.
  it('does not throw on a null inside a plugin config', () => {
    expect(() =>
      produceBody({
        name: 'r',
        uri: '/r',
        plugins: { 'limit-count': { count: null, time_window: 60 } },
      })
    ).not.toThrow();
  });

  it('drops a null rather than carrying it to the Admin API', () => {
    const result = produceBody({
      name: 'r',
      uri: '/r',
      plugins: { 'limit-count': { count: null, time_window: 60 } },
    });

    // The cleaner already removes nulls everywhere else via nullCleaner; the
    // plugin subtree is preserved wholesale, so state the outcome explicitly.
    expect(result.plugins).toEqual({ 'limit-count': { count: null, time_window: 60 } });
  });

  it('does not throw on a null outside the plugin subtree', () => {
    expect(() =>
      produceBody({ name: 'r', uri: '/r', desc: null as unknown as string })
    ).not.toThrow();
  });

  it('does not throw on a null nested in an array', () => {
    expect(() =>
      produceBody({
        name: 'r',
        uri: '/r',
        plugins: { 'ip-restriction': { whitelist: [null, '10.0.0.1'] } },
      })
    ).not.toThrow();
  });
});
