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

import { effectivePriority, inExecutionOrder, withPriority } from './plugin-priority';

// The gateway's own numbers, from GET /apisix/admin/plugins?all=true on
// APISIX 3: auth runs well before rate limiting, which runs before rewriting.
const DEFAULTS = {
  'basic-auth': 2520,
  'key-auth': 2500,
  'proxy-rewrite': 1008,
  'limit-count': 1002,
};

describe('effectivePriority', () => {
  it('is the gateway default when the route says nothing', () => {
    expect(effectivePriority({}, 2500)).toBe(2500);
  });

  it('is the route s own _meta.priority when it sets one', () => {
    expect(effectivePriority({ _meta: { priority: 9000 } }, 2500)).toBe(9000);
  });

  // Zero and negative priorities are legal and meaningful - a plugin pushed
  // behind everything else - so they must not be mistaken for "unset".
  it('keeps a priority of zero or below', () => {
    expect(effectivePriority({ _meta: { priority: 0 } }, 2500)).toBe(0);
    expect(effectivePriority({ _meta: { priority: -10 } }, 2500)).toBe(-10);
  });

  // A plugin this gateway does not know has no default to fall back on. The
  // page says so rather than guessing a number.
  it('has no answer for a plugin the gateway does not list', () => {
    expect(effectivePriority({}, undefined)).toBeUndefined();
    expect(effectivePriority({ _meta: {} }, undefined)).toBeUndefined();
  });

  it('ignores an override that is not a number', () => {
    expect(effectivePriority({ _meta: { priority: 'high' } }, 2500)).toBe(2500);
  });
});

describe('inExecutionOrder', () => {
  // APISIX runs the higher priority first. The order a plugin object happens
  // to be written in means nothing - it is JSON, and has no order.
  it('puts the highest priority first, whatever order the names came in', () => {
    expect(
      inExecutionOrder(['limit-count', 'basic-auth', 'proxy-rewrite'], {}, DEFAULTS)
    ).toEqual(['basic-auth', 'proxy-rewrite', 'limit-count']);
  });

  it('follows an override rather than the default', () => {
    expect(
      inExecutionOrder(
        ['key-auth', 'limit-count'],
        { 'limit-count': { _meta: { priority: 9999 } } },
        DEFAULTS
      )
    ).toEqual(['limit-count', 'key-auth']);
  });

  // Unknown last, and by name among themselves: something has to be shown, and
  // an order that changes between two renders of the same route would be worse
  // than an arbitrary but steady one.
  it('puts plugins of unknown priority last, in name order', () => {
    expect(
      inExecutionOrder(['zeta-plugin', 'key-auth', 'alpha-plugin'], {}, DEFAULTS)
    ).toEqual(['key-auth', 'alpha-plugin', 'zeta-plugin']);
  });

  it('breaks a tie by name, so the list does not shuffle between renders', () => {
    expect(
      inExecutionOrder(
        ['b-plugin', 'a-plugin'],
        { 'b-plugin': { _meta: { priority: 10 } }, 'a-plugin': { _meta: { priority: 10 } } },
        {}
      )
    ).toEqual(['a-plugin', 'b-plugin']);
  });

  it('leaves the input alone', () => {
    const names = ['limit-count', 'basic-auth'];
    inExecutionOrder(names, {}, DEFAULTS);
    expect(names).toEqual(['limit-count', 'basic-auth']);
  });
});

describe('withPriority', () => {
  it('writes the override into _meta, beside whatever else is there', () => {
    expect(withPriority({ key: 'k', _meta: { disable: true } }, 9000)).toEqual({
      key: 'k',
      _meta: { disable: true, priority: 9000 },
    });
  });

  // Clearing the field has to mean "run at the gateway's default", which is
  // the absence of the key - not a priority of zero, which is a real and very
  // different instruction.
  it('removes the override when there is none, and _meta with it', () => {
    expect(withPriority({ key: 'k', _meta: { priority: 10 } }, undefined)).toEqual({
      key: 'k',
    });
  });

  it('leaves the rest of _meta behind when clearing', () => {
    expect(
      withPriority({ _meta: { priority: 10, disable: true } }, undefined)
    ).toEqual({ _meta: { disable: true } });
  });

  // NaN is what a number field hands over mid-edit. It must not reach a
  // config: JSON.stringify turns it into null, which the Admin API refuses.
  it('treats a number that is not one as no priority at all', () => {
    expect(withPriority({ key: 'k', _meta: { priority: 10 } }, Number.NaN)).toEqual({
      key: 'k',
    });
    expect(withPriority({ key: 'k' }, Number.POSITIVE_INFINITY)).toEqual({ key: 'k' });
  });

  it('does not touch the config it was given', () => {
    const config = { _meta: { priority: 10 } };
    withPriority(config, 20);
    expect(config).toEqual({ _meta: { priority: 10 } });
  });
});
