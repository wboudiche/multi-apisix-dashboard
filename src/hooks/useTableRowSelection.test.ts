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
import { readdirSync, readFileSync } from 'node:fs';

import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { tableRowSelection } from './useTableRowSelection';

type Row = { value: { id: string; name?: string } };

// The key and what it was given: what a screen reader would be read, less the
// language.
const t = ((key: string, options?: { name?: string }) =>
  options?.name === undefined ? key : `${key}(${options.name})`) as unknown as TFunction;

const nameOf = (row: Row) => row.value.name || row.value.id;
const selection = (selected: string[] = [], set: (ids: string[]) => void = () => undefined) =>
  tableRowSelection<Row>(t, selected, set, nameOf);

// antd names no row checkbox, and names the header's 'Select all' in English
// whatever the language (#372).
describe('the selection checkboxes of an antd list', () => {
  it('names a row after what the list calls it', () => {
    const props = selection().getCheckboxProps?.({ value: { id: '1', name: 'billing' } });

    expect(props).toEqual({ 'aria-label': 'table.selectRow(billing)' });
  });

  it('names a row with no name after its id', () => {
    const props = selection().getCheckboxProps?.({ value: { id: '1' } });

    expect(props).toEqual({ 'aria-label': 'table.selectRow(1)' });
  });

  it('names the header in the language of the page, not in antd’s', () => {
    expect(selection().getTitleCheckboxProps?.()).toEqual({ 'aria-label': 'table.selectAll' });
  });

  it('hands the table what is ticked, and the page what the table ticks', () => {
    const calls: string[][] = [];
    const given = selection(['a'], (ids) => calls.push(ids));

    expect(given.selectedRowKeys).toEqual(['a']);
    given.onChange?.(['a', 'b'], [], { type: 'multiple' });
    expect(calls).toEqual([['a', 'b']]);
  });
});

// A list that builds its own `rowSelection` has checkboxes with no name, and
// nothing on screen says so.
describe('the list pages', () => {
  const ROUTES = new URL('../routes/', import.meta.url);
  const pages = readdirSync(ROUTES, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, source: readFileSync(new URL(file, ROUTES), 'utf8') }))
    .filter(({ source }) => /\browSelection\b/.test(source));

  it('are found', () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it.each(pages)('$file takes its row selection from useTableRowSelection', ({ source }) => {
    const given = [...source.matchAll(/\browSelection=\{([^}]*)\}?/g)].map((m) => m[1]);

    expect(given).toEqual(['rowSelection']);
    expect(source).toContain('useTableRowSelection(');
  });
});
