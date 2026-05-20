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
/* eslint-disable playwright/no-skipped-test, playwright/expect-expect */
import { test } from '@playwright/test';

// Route team-ownership behavior is already comprehensively tested at
// the API level by multi-instance.spec.ts (the 'Team Ownership'
// describe block — 8 tests: owner can create, owner sees in list,
// other team does not see in list, other team blocked from direct
// access, other team blocked from delete, viewer in different team
// cannot see, admin bypasses ownership, owner can update).
//
// A UI-driven duplicate was attempted in this file but the 5-step
// Add-Route wizard's HTTP-Methods MultiSelect pre-selects
// GET/POST/PUT/DELETE; the dropdown only renders the *unselected*
// methods, so getByRole('option', { name: 'GET' }) never resolves
// and the test times out at step 1. Reliably driving the wizard
// without depending on Mantine MultiSelect internals is more
// scaffolding than the redundant coverage warrants.
//
// To revive: either expose the currently-selected chips as
// removable buttons in the role tree (so the test can use
// getByRole('button', { name: 'Remove GET' }) and re-add), or
// rewire the spec to use the wizard's JSON-edit fallback.

test.describe('route — ownership UI', () => {
  test.skip(
    'covered by multi-instance.spec.ts Team Ownership describe (API level)',
    () => {
      // Intentionally empty — see file header.
    }
  );
});
