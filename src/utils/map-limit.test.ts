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

import { mapLimit } from './map-limit';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('mapLimit', () => {
  it('keeps the order of the items', async () => {
    const out = await mapLimit([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('never has more than the limit under way', async () => {
    let running = 0;
    let most = 0;
    await mapLimit(Array.from({ length: 50 }, (_, i) => i), 8, async () => {
      running++;
      most = Math.max(most, running);
      await tick();
      running--;
    });
    expect(most).toBe(8);
  });

  it('answers an empty list with an empty one', async () => {
    expect(await mapLimit([], 8, async () => 1)).toEqual([]);
  });

  it('rejects with the first failure and starts nothing after it', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 1) throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(started).toEqual([0, 1]);
  });
});
