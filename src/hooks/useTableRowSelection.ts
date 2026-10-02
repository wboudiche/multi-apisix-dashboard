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
import type { AriaAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowSelection } from './useRowSelection';

type RowSelection<T> = NonNullable<TableProps<T>['rowSelection']>;

// antd hands these to the checkbox's input as they are, and types them as a
// checkbox's own props, which name no aria attribute.
type CheckboxNaming = Partial<Omit<CheckboxProps, 'checked' | 'defaultChecked'>> & AriaAttributes;
const named = (label: string): CheckboxNaming => ({ 'aria-label': label });

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

/**
 * The selection of an antd list page: see useRowSelection for what is
 * selected, and tableRowSelection for what the table is given.
 *
 * `idOf` is the id a row is ticked and deleted by, and `nameOf` what the list
 * calls it - its name, or its id when it has none.
 */
export const useTableRowSelection = <T>(
  rows: readonly T[],
  listKey: string,
  idOf: (row: T) => string,
  nameOf: (row: T) => string
) => {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useRowSelection(rows.map(idOf), listKey);
  return {
    selectedIds,
    setSelectedIds,
    rowSelection: tableRowSelection(t, selectedIds, setSelectedIds, nameOf),
  };
};
