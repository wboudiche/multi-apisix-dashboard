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

import { summarizeHealth } from './upstream-health';

describe('summarizeHealth', () => {
  // The three answers that are not measurements, and the reason this function
  // exists: each calls for something different, and showing any of them as a
  // colour would be a claim nobody made.
  it('says nothing was known when the gateway could not be asked', () => {
    expect(summarizeHealth(undefined)).toEqual({ state: 'unknown' });
    expect(summarizeHealth(null)).toEqual({ state: 'unknown' });
    expect(summarizeHealth('healthy')).toEqual({ state: 'unknown' });
  });

  it('tells an upstream nothing watches from one that is failing', () => {
    expect(summarizeHealth({ checked: false })).toEqual({ state: 'unchecked' });
  });

  // APISIX builds a checker the first time an upstream is used, so one that
  // has never served a request is watched with nothing measured yet.
  it('tells a checker with no measurement from one reporting bad news', () => {
    expect(summarizeHealth({ checked: true, nodes: [] })).toEqual({ state: 'pending' });
  });

  it('counts the nodes in rotation against the whole', () => {
    expect(
      summarizeHealth({
        checked: true,
        nodes: [
          { host: '127.0.0.1', port: 1980, status: 'healthy' },
          { host: '127.0.0.1', port: 1981, status: 'healthy' },
        ],
      })
    ).toEqual({ state: 'up', up: 2, total: 2 });

    expect(
      summarizeHealth({
        checked: true,
        nodes: [
          { host: '127.0.0.1', port: 1980, status: 'healthy' },
          { host: '127.0.0.1', port: 1981, status: 'unhealthy' },
        ],
      })
    ).toEqual({ state: 'mixed', up: 1, total: 2 });

    expect(
      summarizeHealth({
        checked: true,
        nodes: [{ host: '127.0.0.1', port: 1980, status: 'unhealthy' }],
      })
    ).toEqual({ state: 'down', up: 0, total: 1 });
  });

  // resty.healthcheck moves a target through mostly_healthy and
  // mostly_unhealthy while its counters fill. The first is still in rotation;
  // the second is not, and reading it as "nearly fine" would be the wrong way
  // round.
  it('reads the states a checker passes through on its way', () => {
    expect(
      summarizeHealth({
        checked: true,
        nodes: [
          { host: 'a', port: 1, status: 'mostly_healthy' },
          { host: 'b', port: 2, status: 'mostly_unhealthy' },
        ],
      })
    ).toEqual({ state: 'mixed', up: 1, total: 2 });
  });

  // A state this build has never heard of is not counted as in rotation - the
  // safe reading of an unknown word is that the node may not be serving - but
  // it does not make the row red either, which would be a firm claim drawn
  // from a word nobody recognised.
  it('neither trusts nor condemns a state it does not know', () => {
    expect(
      summarizeHealth({
        checked: true,
        nodes: [{ host: 'a', port: 1, status: 'quarantined' }],
      })
    ).toEqual({ state: 'mixed', up: 0, total: 1 });

    // Said plainly by a checker, though, it is red.
    expect(
      summarizeHealth({
        checked: true,
        nodes: [{ host: 'a', port: 1, status: 'unhealthy' }],
      })
    ).toEqual({ state: 'down', up: 0, total: 1 });
  });
});
