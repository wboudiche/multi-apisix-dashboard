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
import {
  CloseButton,
  Combobox,
  ScrollArea,
  SimpleGrid,
  TextInput,
  type TextInputProps,
  useVirtualizedCombobox,
} from '@mantine/core';
import { useLocalObservable } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { PluginCard, type PluginCardProps } from './PluginCard';

type PluginCardListSearchProps = Pick<TextInputProps, 'placeholder'> & {
  search: string;
  setSearch: (search: string) => void;
};
export const PluginCardListSearch = (props: PluginCardListSearchProps) => {
  const { placeholder, search, setSearch } = props;
  const { t } = useTranslation();
  return (
    <TextInput
      placeholder={placeholder || t('form.search')}
      value={search}
      style={{ flexGrow: 1, position: 'sticky', top: 0 }}
      onChange={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setSearch(event.currentTarget.value);
      }}
      rightSectionPointerEvents="all"
      rightSection={
        <CloseButton
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setSearch('');
          }}
        />
      }
    />
  );
};

type OptionProps = Pick<
  PluginCardProps,
  | 'onAdd'
  | 'onEdit'
  | 'onDelete'
  | 'onView'
  | 'mode'
  | 'description'
  | 'config'
  | 'priority'
  | 'priorityOverridden'
> & {
  name: string;
};
const Option = (props: OptionProps) => {
  const {
    mode,
    name,
    description,
    config,
    priority,
    priorityOverridden,
    onAdd,
    onEdit,
    onDelete,
    onView,
  } = props;
  return (
    <Combobox.Option key={name} value={name} p={0}>
      <PluginCard
        mode={mode}
        name={name}
        description={description}
        config={config}
        priority={priority}
        priorityOverridden={priorityOverridden}
        onAdd={() => onAdd?.(name)}
        onEdit={() => onEdit?.(name)}
        onDelete={() => onDelete?.(name)}
        onView={() => onView?.(name)}
      />
    </Combobox.Option>
  );
};

const Options = (props: { list: OptionProps[] }) => {
  const { list } = props;
  return (
    <>
      {list.map((option) => (
        <Option key={option.name} {...option} />
      ))}
    </>
  );
};

export type PluginCardListProps = Omit<OptionProps, 'name' | 'description' | 'config'> &
  Pick<TextInputProps, 'placeholder'> & {
    cols?: number;
    h?: number | string;
    mah?: number | string;
    search: string;
    plugins: string[];
    descriptions?: Record<string, string>;
    configs?: Record<string, object>;
    /**
     * The priority each plugin will run at, and the names the route set one
     * for. The list is shown in the order it is given: the caller decides it,
     * because it is the caller that holds both halves of the answer (#48).
     */
    priorities?: Record<string, number | undefined>;
    overridden?: Set<string>;
  };

export const PluginCardList = (props: PluginCardListProps) => {
  const {
    search = '',
    cols = 3,
    h,
    mah,
    plugins,
    descriptions,
    configs,
    priorities,
    overridden,
  } = props;
  const { mode, onAdd, onEdit, onDelete, onView } = props;
  const { t } = useTranslation();
  const combobox = useVirtualizedCombobox();
  const optionsOb = useLocalObservable(() => ({
    search: '',
    plugins: [] as string[],
    setSearch(search: string) {
      this.search = search.toLowerCase().trim();
    },
    setPlugins(plugins: string[]) {
      this.plugins = plugins;
    },
    // Names only. What is known *about* each plugin is read at render time
    // from the props: this store is created once, so its closure holds the
    // props of the first render - and on that render the gateway's catalogue
    // has not been handed down yet. The descriptions had the same staleness
    // and it went unseen, because the card falls back to a built-in table
    // when one is missing (#48).
    get list() {
      return !this.search
        ? this.plugins
        : this.plugins.filter((d) => d.toLowerCase().includes(this.search));
    },
  }));

  const options: OptionProps[] = optionsOb.list.map((name) => ({
    name,
    mode,
    description: descriptions?.[name],
    config: configs?.[name],
    priority: priorities?.[name],
    priorityOverridden: overridden?.has(name),
    onAdd,
    onEdit,
    onDelete,
    onView,
  }));

  useEffect(() => optionsOb.setPlugins(plugins), [optionsOb, plugins]);
  useEffect(() => optionsOb.setSearch(search), [optionsOb, search]);

  return (
    <Combobox store={combobox}>
      <Combobox.Options mt="1em">
        <ScrollArea.Autosize h={h} mah={mah} type="scroll">
          {!options.length ? (
            <Combobox.Empty>{t('noData')}</Combobox.Empty>
          ) : (
            <SimpleGrid cols={cols}>
              <Options list={options} />
            </SimpleGrid>
          )}
        </ScrollArea.Autosize>
      </Combobox.Options>
    </Combobox>
  );
};
