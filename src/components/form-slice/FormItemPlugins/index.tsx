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
  Drawer,
  Group,
  InputWrapper,
  type InputWrapperProps,
  Text,
} from '@mantine/core';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { toJS } from 'mobx';
import { useLocalObservable } from 'mobx-react-lite';
import { difference } from 'rambdax';
import { useEffect, useMemo } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDeepCompareEffect } from 'react-use';

import {
  getPluginsListWithSchemaQueryOptions,
  type NeedPluginSchema,
} from '@/apis/plugins';
import { genControllerProps } from '@/components/form/util';
import { currentInstanceIdAtom } from '@/stores/instance';
import type { APISIXType } from '@/types/schema/apisix';
import type { PluginConfigValue } from '@/utils/plugin-priority';
import { effectivePriority, inExecutionOrder } from '@/utils/plugin-priority';

import type { PluginCardProps } from './PluginCard';
import { PluginCardList, PluginCardListSearch } from './PluginCardList';
import { type PluginConfig, PluginEditorDrawer } from './PluginEditorDrawer';
import { getPluginCategory } from './pluginMetadata';
import { SelectPluginsDrawer } from './SelectPluginsDrawer';

export type PluginContext = 'route' | 'consumer';

export type FormItemPluginsProps<T extends FieldValues> = InputWrapperProps &
  UseControllerProps<T> & {
    onChange?: (value: Record<string, unknown>) => void;
    context?: PluginContext;
  } & Partial<NeedPluginSchema>;

export const FormItemPlugins = <T extends FieldValues>(
  props: FormItemPluginsProps<T>
) => {
  const { context, ...propsWithoutContext } = props;
  const {
    controllerProps,
    restProps: { schema = 'schema', ...restProps },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = genControllerProps(propsWithoutContext as any, {});
  const { t } = useTranslation();

  const {
    field: { value: rawObject, onChange: fOnChange, name: fName, ...restField },
    fieldState,
  } = useController<T>(controllerProps as UseControllerProps<T>);
  const isView = useMemo(() => restField.disabled, [restField.disabled]);

  const pluginsOb = useLocalObservable(() => ({
    __map: new Map<string, object>(),
    init(obj: Record<string, object>) {
      this.__map = new Map(Object.entries(obj));
    },
    delete(name: string) {
      this.__map.delete(name);
      this.save();
    },
    allPluginNames: [] as string[],
    pluginSchemaObj: new Map<string, APISIXType['PluginSchema']>(),
    initPlugins(props: {
      names: string[];
      originObj: Record<string, Record<string, unknown>>;
    }) {
      const { names, originObj } = props;
      this.allPluginNames = context === 'consumer'
        ? names.filter((n) => getPluginCategory(n) === 'authentication')
        : names;
      this.pluginSchemaObj = new Map(Object.entries(originObj));
    },
    // In the order the gateway will run them, not the order they were added:
    // a route's `plugins` is a JSON object and has no order, so a list by
    // insertion said nothing about what happens to a request (#48).
    get selected() {
      return inExecutionOrder(
        Array.from(this.__map.keys()),
        this.configsMap as Record<string, PluginConfigValue>,
        this.priorityDefaults
      );
    },
    // What the gateway says each plugin runs at by default. It serves this
    // beside the schemas, so the page does not have to carry a table of its
    // own - one that would drift with every APISIX release.
    get priorityDefaults(): Record<string, number | undefined> {
      const result: Record<string, number | undefined> = {};
      for (const [name, schemaData] of this.pluginSchemaObj.entries()) {
        const priority = (schemaData as { priority?: unknown })?.priority;
        if (typeof priority === 'number') result[name] = priority;
      }
      return result;
    },
    get priorities(): Record<string, number | undefined> {
      const result: Record<string, number | undefined> = {};
      for (const name of this.__map.keys()) {
        result[name] = effectivePriority(
          this.__map.get(name) as PluginConfigValue,
          this.priorityDefaults[name]
        );
      }
      return result;
    },
    // The ones this route sets a priority for, so the badge can say the number
    // is a decision rather than the gateway's own.
    get overridden(): Set<string> {
      const names = new Set<string>();
      for (const [name, config] of this.__map.entries()) {
        const own = (config as PluginConfigValue)?._meta?.priority;
        // Number.isFinite, like effectivePriority: a NaN left in a stored
        // config would otherwise badge as "set here" while the number shown
        // beside it came from the gateway.
        if (typeof own === 'number' && Number.isFinite(own)) names.add(name);
      }
      return names;
    },
    get unSelected() {
      return difference(this.allPluginNames, this.selected);
    },
    get configsMap(): Record<string, object> {
      const result: Record<string, object> = {};
      for (const [k, v] of this.__map.entries()) {
        result[k] = v;
      }
      return result;
    },
    get descriptionsMap(): Record<string, string> {
      const result: Record<string, string> = {};
      for (const [name, schemaData] of this.pluginSchemaObj.entries()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = schemaData as any;
        if (s?.schema?.description) {
          result[name] = s.schema.description;
        }
      }
      return result;
    },
    save() {
      const obj = Object.fromEntries(toJS(this.__map));
      fOnChange(obj);
    },
    update(config: PluginConfig) {
      const { name, config: pluginConfig } = config;
      this.__map.set(name, pluginConfig);
      this.save();
      this.setSelectPluginsOpened(false);
    },
    curPlugin: {} as PluginConfig,
    setCurPlugin(name: string) {
      this.curPlugin = {
        name,
        config: this.__map.get(name),
      } as PluginConfig;
      this.setEditorOpened(true);
    },
    get curPluginSchema() {
      const d = this.pluginSchemaObj.get(this.curPlugin.name);
      if (!d) return {};
      return d[schema as keyof typeof d];
    },
    editorOpened: false,
    setEditorOpened(val: boolean) {
      this.editorOpened = val;
    },
    closeEditor() {
      this.setEditorOpened(false);
      this.curPlugin = {} as PluginConfig;
    },
    search: '',
    setSearch(val: string) {
      this.search = val;
    },
    mode: 'edit' as PluginCardProps['mode'],
    selectPluginsOpened: false,
    setSelectPluginsOpened(val: boolean) {
      this.selectPluginsOpened = val;
    },
    on(mode: PluginCardProps['mode'], name: string) {
      this.setCurPlugin(name);
      this.mode = mode;
    },
  }));

  // The catalogue is the gateway's own: two instances on different APISIX
  // versions offer different plugins and schemas (#180).
  const instanceId = useAtomValue(currentInstanceIdAtom);
  const pluginsListReq = useSuspenseQuery(
    getPluginsListWithSchemaQueryOptions({ schema }, instanceId)
  );

  // init the selected plugins
  useEffect(() => {
    pluginsOb.init(rawObject);
  }, [pluginsOb, rawObject]);
  useDeepCompareEffect(() => {
    pluginsOb.initPlugins(pluginsListReq.data);
  }, [pluginsOb, pluginsListReq.data]);

  return (
    <InputWrapper error={fieldState.error?.message} {...restProps}>
      <input name={fName} type="hidden" />
      <Drawer.Stack>
        {!isView && (
          <Group>
            <PluginCardListSearch
              search={pluginsOb.search}
              setSearch={pluginsOb.setSearch}
            />
            <SelectPluginsDrawer
              plugins={pluginsOb.unSelected}
              opened={pluginsOb.selectPluginsOpened}
              setOpened={pluginsOb.setSelectPluginsOpened}
              onAdd={(name) => pluginsOb.on('add', name)}
              disabled={restField.disabled}
            />
          </Group>
        )}
        {/* Said out loud: the cards moved from insertion order to execution
            order, and a list that reorders itself without saying why looks
            like a bug (#48). One plugin has no order to speak of. */}
        {pluginsOb.selected.length > 1 && (
          <Text size="xs" c="dimmed" mt="xs">
            {t('form.plugins.orderedByPriority')}
          </Text>
        )}
        <PluginCardList
          mode={isView ? 'view' : 'edit'}
          placeholder={t('form.plugins.searchForSelectedPlugins')}
          mah="60vh"
          search={pluginsOb.search}
          plugins={pluginsOb.selected}
          descriptions={pluginsOb.descriptionsMap}
          configs={pluginsOb.configsMap}
          priorities={pluginsOb.priorities}
          overridden={pluginsOb.overridden}
          onDelete={pluginsOb.delete}
          onView={(name) => pluginsOb.on('view', name)}
          onEdit={(name) => pluginsOb.on('edit', name)}
        />
        <PluginEditorDrawer
          showPriority
          defaultPriority={pluginsOb.priorityDefaults[pluginsOb.curPlugin.name]}
          mode={isView ? 'view' : pluginsOb.mode}
          schema={toJS(pluginsOb.curPluginSchema)}
          opened={pluginsOb.editorOpened}
          onClose={pluginsOb.closeEditor}
          plugin={toJS(pluginsOb.curPlugin)}
          onSave={pluginsOb.update}
        />
      </Drawer.Stack>
    </InputWrapper>
  );
};
