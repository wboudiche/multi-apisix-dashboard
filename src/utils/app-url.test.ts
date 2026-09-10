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

import { appUrl } from './app-url';

describe('appUrl', () => {
  it('puts an in-app path under the base the app is served from', () => {
    // The literal is deliberate. BASE_PATH is what the router and Vite are
    // both configured with, so a change to it is a change to every bookmark
    // and every deployment — it should not slip through on a test that
    // recomputes the expectation from the value it is checking.
    expect(appUrl('/login')).toBe('/ui/login');
    expect(appUrl('/change-password')).toBe('/ui/change-password');
  });

  it('takes a path written without a leading slash', () => {
    // `${BASE_PATH}${path}` reads as correct and gives `/uilogin` here. The
    // caller writes a route, not a URL fragment; both spellings are the same
    // route.
    expect(appUrl('login')).toBe('/ui/login');
  });
});
