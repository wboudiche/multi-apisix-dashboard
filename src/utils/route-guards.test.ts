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

import {
  isChangePasswordPath,
  isLoginPath,
  requiresInstance,
} from './route-guards';

/**
 * These take a pathname as the router hands it over: `basepath` is set once in
 * `src/config/global.ts`, and router-core removes it on the way in — exactly
 * `/ui` or a `/ui/` prefix, nothing else (`rewriteBasepath`, router-core
 * 1.171.28). So the base never reaches these functions, and a path that still
 * carries it is not the base: it is a route whose first segment starts with
 * those two letters.
 */
describe('the pages that render without the app shell', () => {
  it('are the login and change-password routes', () => {
    expect(isLoginPath('/login')).toBe(true);
    expect(isChangePasswordPath('/change-password')).toBe(true);
    expect(isLoginPath('/overview')).toBe(false);
    expect(isChangePasswordPath('/login')).toBe(false);
  });

  it('are not a route that merely begins with the base path', () => {
    // /ui/login is not the login page seen through the base - the router has
    // already taken the base off. It is a `login` page under a `ui` route,
    // which is not this app's, and answering "yes" to it hands a page the app
    // shell decides about by name (#169).
    expect(isLoginPath('/ui/login')).toBe(false);
    expect(isChangePasswordPath('/ui/change-password')).toBe(false);
  });
});

describe('the pages that need a selected instance', () => {
  it('are the ones that talk to a gateway', () => {
    expect(requiresInstance('/routes')).toBe(true);
    expect(requiresInstance('/services')).toBe(true);
    expect(requiresInstance('/routes/detail/abc')).toBe(true);
  });

  it('are not the landing pages, nor the dashboard’s own CRUD', () => {
    // Overview aggregates across instances; instances, teams and users are
    // admin CRUD that lives entirely in the dashboard's own etcd.
    expect(requiresInstance('/')).toBe(false);
    expect(requiresInstance('/overview')).toBe(false);
    expect(requiresInstance('/instances')).toBe(false);
    expect(requiresInstance('/instances/i1')).toBe(false);
    expect(requiresInstance('/teams/t1')).toBe(false);
    expect(requiresInstance('/users/u1')).toBe(false);
  });

  it('are decided on the path as given, base path or not', () => {
    // The trap #169 is about: `pathname.replace(/^\/ui/, '')` is not anchored
    // to a separator, so a route named `ui`, or one whose first segment merely
    // starts with it, came out of it shortened - `/ui` as `''`, the app root,
    // which needs no instance, and `/uikit` as `kit`, which matches nothing in
    // either list.
    expect(requiresInstance('/ui')).toBe(true);
    expect(requiresInstance('/uikit')).toBe(true);
    expect(requiresInstance('/ui-settings')).toBe(true);
  });
});
