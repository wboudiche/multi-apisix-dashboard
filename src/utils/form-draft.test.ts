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

import { withoutPluginSecrets } from './form-draft';

describe('withoutPluginSecrets', () => {
  it('drops client_secret from every plugin and keeps the rest', () => {
    const values = {
      name: 'r',
      plugins: {
        'openid-connect': { client_id: 'a', client_secret: 's1', discovery: 'd' },
        'authz-keycloak': { client_secret: 's2' },
        'limit-count': { count: 1 },
      },
    };
    expect(withoutPluginSecrets(values)).toEqual({
      name: 'r',
      plugins: {
        'openid-connect': { client_id: 'a', discovery: 'd' },
        'authz-keycloak': {},
        'limit-count': { count: 1 },
      },
    });
    // The form's own values are left alone.
    expect(values.plugins['openid-connect'].client_secret).toBe('s1');
  });
  it('leaves values without plugins as they are', () => {
    expect(withoutPluginSecrets({ name: 'r' })).toEqual({ name: 'r' });
    expect(withoutPluginSecrets({ name: 'r', plugins: null })).toEqual({ name: 'r', plugins: null });
    expect(withoutPluginSecrets({ plugins: { p: null, q: 'x' } })).toEqual({ plugins: { p: null, q: 'x' } });
  });
});
