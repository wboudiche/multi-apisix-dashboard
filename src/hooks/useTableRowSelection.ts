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
import type { CheckboxProps, TableProps } from 'antd';
import type { TFunction } from 'i18next';
import { type AriaAttributes, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowSelection } from './useRowSelection';

type RowSelection<T> = NonNullable<TableProps<T>['rowSelection']>;

// antd hands these to the checkbox's input as they are, and types them as a
// checkbox's own props, which name no aria attribute.
type CheckboxNaming = Partial<Omit<CheckboxProps, 'checked' | 'defaultChecked'>> & AriaAttributes;
const named = (label: string): CheckboxNaming => ({ 'aria-label': label });

/** A row's id, where the id is what a list selects by. */
export const rowId = (row: { value: { id: string } }) => row.value.id;
/** What most lists call a row: its name, or its id when it has none. */
export const rowNameOrId = (row: { value: { id: string; name?: string } }) =>
  row.value.name || row.value.id;

/**
 * What to call each row of a list, by its id: what the list calls it, with
 * its id beside it where the list calls another row the same.
 *
 * Names are not unique - two certificates for one SNI are the ordinary way to
 * serve RSA and ECDSA, and nothing stops two upstreams sharing a name - and
 * two checkboxes named alike are no better than two with no name: which of
 * them a batch delete takes cannot be told.
 */
export const rowNames = <T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  nameOf: (row: T) => string
): Map<string, string> => {
  const rowsCalled = new Map<string, number>();
  for (const row of rows) {
    const name = nameOf(row);
    rowsCalled.set(name, (rowsCalled.get(name) ?? 0) + 1);
  }
  return new Map(
    rows.map((row) => {
      const id = idOf(row);
      const name = nameOf(row);
      const shared = (rowsCalled.get(name) ?? 0) > 1 && name !== id;
      return [id, shared ? `${name} (${id})` : name];
    })
  );
};

/**
 * The `rowSelection` of an antd list: what is ticked, and a name for every
 * checkbox.
 *
 * antd gives a row's checkbox no name at all - a screen reader read "checkbox,
 * unchecked" once per row, and rows were ticked for a batch delete blind - and
 * names the header's itself, 'Select all', in English whatever the language
 * (#372). A row's is named after what the row is called on screen, as on the
 * routes list (#348).
 */
export const tableRowSelection = <T>(
  t: TFunction,
  selectedIds: string[],
  setSelectedIds: (ids: string[]) => void,
  nameOf: (row: T) => string
): RowSelection<T> => ({
  selectedRowKeys: selectedIds,
  onChange: (keys) => setSelectedIds(keys as string[]),
  getCheckboxProps: (row) => named(t('table.selectRow', { name: nameOf(row) })),
  getTitleCheckboxProps: () => named(t('table.selectAll')),
});

export type RowNaming<T> = {
  /** The id a row is keyed, ticked and deleted by. */
  idOf: (row: T) => string;
  /** What the list calls the row, when that is not its id. */
  nameOf?: (row: T) => string;
};

/**
 * The selection of an antd list page: see useRowSelection for what is
 * selected, and tableRowSelection for what the table is given.
 *
 * It returns the table's `rowKey` as well: the selection is a list of row
 * keys, so a page that keyed its rows by one function and selected by
 * another would tick nothing, or delete something else.
 *
 * `idOf` and `nameOf` are best given as functions that do not change between
 * renders - the ones above, or the page's own at module level: antd works out
 * every row's checkbox again whenever it is handed a new `rowSelection`.
 */
export const useTableRowSelection = <T>(
  rows: readonly T[],
  listKey: string,
  { idOf, nameOf = idOf }: RowNaming<T>
) => {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useRowSelection(rows.map(idOf), listKey);
  const rowSelection = useMemo(() => {
    const names = rowNames(rows, idOf, nameOf);
    return tableRowSelection<T>(
      t,
      selectedIds,
      setSelectedIds,
      (row) => names.get(idOf(row)) ?? nameOf(row)
    );
  }, [t, selectedIds, setSelectedIds, rows, idOf, nameOf]);
  return { selectedIds, setSelectedIds, rowSelection, rowKey: idOf };
};
