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
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { rowId, rowNameOrId, rowNames, tableRowSelection } from './useTableRowSelection';

type Row = { value: { id: string; name?: string } };

// The key and what it was given: what a screen reader would be read, less the
// language.
const t = ((key: string, options?: { name?: string }) =>
  options?.name === undefined ? key : `${key}(${options.name})`) as unknown as TFunction;

const selection = (selected: string[] = [], set: (ids: string[]) => void = () => undefined) =>
  tableRowSelection<Row>(t, selected, set, rowNameOrId);

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

// Two certificates for one SNI are the ordinary way to serve RSA and ECDSA,
// and two checkboxes named alike are no better than two with no name.
describe('what the rows of a list are called', () => {
  const rows: Row[] = [
    { value: { id: '1', name: 'billing' } },
    { value: { id: '2', name: 'billing' } },
    { value: { id: '3', name: 'search' } },
    { value: { id: '4' } },
  ];
  const names = rowNames(rows, rowId, rowNameOrId);

  it('is its name, where no other row on the list has it', () => {
    expect(names.get('3')).toBe('search');
  });

  it('is its name and its id, where another row has the name', () => {
    expect(names.get('1')).toBe('billing (1)');
    expect(names.get('2')).toBe('billing (2)');
  });

  it('is its id, once, where it has no name', () => {
    expect(names.get('4')).toBe('4');
  });

  it('tells apart a row named after another row’s id', () => {
    const called = rowNames(
      [{ value: { id: '7' } }, { value: { id: '8', name: '7' } }],
      rowId,
      rowNameOrId
    );

    expect(called.get('7')).toBe('7');
    expect(called.get('8')).toBe('7 (8)');
  });
});
