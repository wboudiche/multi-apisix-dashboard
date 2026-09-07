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
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);

/**
 * react and react-dom must be the exact same version. React itself checks this
 * — but only in its development build:
 *
 *   $ grep -c 'Incompatible React versions' react-dom/cjs/*.js
 *   react-dom-client.development.js:1
 *   react-dom-client.production.js:0
 *
 * So a skewed pair throws a blank page in dev and e2e, and ships silently to
 * production. It reached main once already, because Dependabot opens a PR per
 * npm package and react-dom's peer range accepts a newer react without a word
 * (see #121, and the group in .github/dependabot.yml).
 *
 * Grouping stops Dependabot from causing it. This states the invariant itself,
 * so a manual upgrade or a bad merge fails here in milliseconds rather than
 * forty minutes into a cancelled e2e shard.
 */
describe('react and react-dom pairing', () => {
  it('resolves both packages to the exact same version', () => {
    const react = require_('react/package.json') as { version: string };
    const reactDom = require_('react-dom/package.json') as { version: string };

    expect(reactDom.version).toBe(react.version);
  });

  it('declares both at the same version, pinned rather than ranged', () => {
    const pkg = require_('../package.json') as {
      dependencies: Record<string, string>;
    };

    // Pinned exactly: a caret on either would let an install drift them apart
    // again without any file in the repo changing.
    expect(pkg.dependencies['react-dom']).toBe(pkg.dependencies['react']);
    expect(pkg.dependencies['react']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
