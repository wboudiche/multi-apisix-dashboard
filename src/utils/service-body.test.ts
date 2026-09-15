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

import { produceServiceBody } from './service-body';

type Body = Record<string, unknown>;

const produce = produceServiceBody as (value: Body) => Body;

const upstream = { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] };

describe('produceServiceBody', () => {
  // `{"key-auth": {}}` enables the plugin with its defaults; dropping it
  // creates the service without the authentication the operator chose (#223).
  it('keeps a plugin enabled with an empty config', () => {
    const result = produce({ name: 's', upstream, plugins: { 'key-auth': {} } });

    expect(result.plugins).toEqual({ 'key-auth': {} });
  });

  it('keeps the empty objects a multi-auth config is made of', () => {
    const plugins = { 'multi-auth': { auth_plugins: [{ 'basic-auth': {} }, { 'key-auth': {} }] } };

    expect(produce({ name: 's', upstream, plugins }).plugins).toEqual(plugins);
  });

  it('still drops blank fields outside the plugins', () => {
    const result = produce({
      name: 's',
      desc: '',
      hosts: [],
      labels: {},
      upstream_id: 'custom',
      upstream: { ...upstream, key: '' },
      plugins: { 'key-auth': {} },
    });

    expect(result).toEqual({ name: 's', upstream, plugins: { 'key-auth': {} } });
  });
});
