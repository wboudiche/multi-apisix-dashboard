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

import { deleteConfirmKey, oidcStatusView, routesLabel, teamLabel } from './oidc-clients';

describe('the status of an OIDC client', () => {
  it('has a colour and a label per state', () => {
    expect(oidcStatusView('ok').color).toBe('green');
    expect(oidcStatusView('no_route').color).toBe('orange');
    expect(oidcStatusView('missing').color).toBe('red');
    expect(oidcStatusView('changed').color).toBe('yellow');
    expect(oidcStatusView('unknown').color).toBe('gray');
  });

  it('explains only unknown', () => {
    expect(oidcStatusView('unknown').helpKey).toBe('settings.oidcClients.status.unknownHelp');
    expect(oidcStatusView('ok').helpKey).toBeUndefined();
  });

  it('reads an absent or unforeseen status as unknown', () => {
    expect(oidcStatusView(undefined).color).toBe('gray');
    expect(oidcStatusView('whatever' as never).color).toBe('gray');
  });
});

describe('the confirmation of a delete', () => {
  it('names the routes when there are some', () => {
    expect(deleteConfirmKey(['r1', 'r2'])).toBe('settings.oidcClients.deleteConfirmRoutes');
  });
  it('is plain without routes', () => {
    expect(deleteConfirmKey([])).toBe('settings.oidcClients.deleteConfirm');
    expect(deleteConfirmKey(undefined)).toBe('settings.oidcClients.deleteConfirm');
  });
});

describe('the cells', () => {
  it('joins the route ids, or shows a dash', () => {
    expect(routesLabel(['a', 'b'])).toBe('a, b');
    expect(routesLabel([])).toBe('—');
    expect(routesLabel(undefined)).toBe('—');
  });
  it('shows the team name, the id when unnamed, a dash for none', () => {
    const names = new Map([['t1', 'Blue']]);
    expect(teamLabel('t1', names)).toBe('Blue');
    expect(teamLabel('t2', names)).toBe('t2');
    expect(teamLabel('', names)).toBe('—');
    expect(teamLabel(undefined, names)).toBe('—');
  });
});
