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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TEST_UPSTREAM_MAX_NODES } from './constant';

/**
 * The upstream form splits its nodes into batches the backend will take. A
 * batch over the backend's limit is refused whole, with a 400, so the two
 * numbers are read from their sources and compared rather than trusted to
 * move together.
 */
describe('the batch size of the upstream connection test', () => {
  it('is the most nodes the backend tests per request', () => {
    const goSource = readFileSync(
      join(import.meta.dirname, '..', '..', 'api', 'internal', 'handlers', 'upstream.go'),
      'utf8'
    );
    const match = goSource.match(/^\s*maxTestNodes\s*=\s*(\d+)\s*$/m);
    if (!match) throw new Error('no maxTestNodes constant in upstream.go');

    expect(TEST_UPSTREAM_MAX_NODES).toBe(Number(match[1]));
  });
});
