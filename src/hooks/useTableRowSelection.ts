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

/** A name with the id beside it, in the words of the page. */
export type WithId = (name: string, id: string) => string;

/**
 * What to call each row of a list, by its id: what the list calls it, with
 * its id beside it where that alone would not tell it from another row.
 *
 * Names are not unique - two certificates for one SNI are the ordinary way to
 * serve RSA and ECDSA, and nothing stops two upstreams sharing a name - and
 * two checkboxes named alike are no better than two with no name: which of
 * them a batch delete takes cannot be told.
 *
 * Until every row is called something of its own: a row can be named exactly
 * what another became once its id was added, "billing (1)" beside two rows
 * called "billing".
 *
 * Ids and names are compared as text. A gateway keeps the type an id was
 * written with, and a row whose id is the number 7 is called the same as one
 * named "7".
 */
export const rowNames = <T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  nameOf: (row: T) => string,
  withId: WithId
): Map<string, string> => {
  const named = rows.map((row) => ({ id: String(idOf(row)), name: String(nameOf(row)) }));
  // The rows told apart by their id so far, each with what that makes it.
  const told = new Map<string, string>();
  const called = ({ id, name }: { id: string; name: string }) => told.get(id) ?? name;
  for (;;) {
    const rowsCalled = new Map<string, number>();
    for (const row of named) rowsCalled.set(called(row), (rowsCalled.get(called(row)) ?? 0) + 1);
    // A row called by its id already says it.
    const alike = named.filter(
      (row) => !told.has(row.id) && row.name !== row.id && (rowsCalled.get(row.name) ?? 0) > 1
    );
    if (alike.length === 0) break;
    for (const { id, name } of alike) told.set(id, withId(name, id));
  }
  return new Map(named.map((row) => [row.id, called(row)]));
};

/** The checkbox names of a list, in the page's language: see rowNames. */
export const checkboxNames = <T>(
  t: TFunction,
  rows: readonly T[],
  idOf: (row: T) => string,
  nameOf: (row: T) => string
) => rowNames(rows, idOf, nameOf, (name, id) => t('table.nameWithId', { name, id }));

/**
 * A name for every checkbox of an antd list's selection.
 *
 * antd gives a row's checkbox no name at all - a screen reader read "checkbox,
 * unchecked" once per row, and rows were ticked for a batch delete blind - and
 * names the header's itself, 'Select all', in English whatever the language
 * (#372). A row's is named after what the row is called on screen, as on the
 * routes list (#348).
 */
export const checkboxNaming = <T>(
  t: TFunction,
  nameOf: (row: T) => string
): Pick<RowSelection<T>, 'getCheckboxProps' | 'getTitleCheckboxProps'> => ({
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
 * selected, and checkboxNaming for what its checkboxes are called.
 *
 * `tableProps` is spread on the table, and holds its `rowKey` with its
 * `rowSelection`: the selection is a list of row keys, so a table keyed by
 * one function and selecting by another would tick nothing, or delete
 * something else. ESLint refuses a `rowSelection` given to a table any other
 * way, and a `rowKey` written beside the spread.
 *
 * `idOf` and `nameOf` are best given as functions that do not change between
 * renders - the ones above, or the page's own at module level: antd works out
 * every row's checkbox again whenever the function that names them is a new
 * one.
 */
export const useTableRowSelection = <T>(
  rows: readonly T[],
  listKey: string,
  { idOf, nameOf = idOf }: RowNaming<T>
) => {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useRowSelection(rows.map(idOf), listKey);
  // Apart from what is ticked: antd keeps what it worked out for each row's
  // checkbox for as long as `getCheckboxProps` is the same function, and a
  // tick is no reason to name five hundred rows again.
  const naming = useMemo(() => {
    const names = checkboxNames(t, rows, idOf, nameOf);
    return checkboxNaming<T>(t, (row) => names.get(String(idOf(row))) ?? nameOf(row));
  }, [t, rows, idOf, nameOf]);
  const tableProps = useMemo(
    () => ({
      rowKey: idOf,
      // eslint-disable-next-line no-restricted-syntax -- the one place a rowSelection is made
      rowSelection: {
        ...naming,
        selectedRowKeys: selectedIds,
        onChange: (keys) => setSelectedIds(keys as string[]),
      } satisfies RowSelection<T>,
    }),
    [idOf, naming, selectedIds, setSelectedIds]
  );
  return { selectedIds, setSelectedIds, tableProps };
};
