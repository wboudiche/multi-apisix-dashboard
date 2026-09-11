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
import { Alert, Center, Drawer, Group, Loader } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { toJS } from 'mobx';
import { useLocalObservable } from 'mobx-react-lite';
import { difference } from 'rambdax';
import { useTranslation } from 'react-i18next';
import { useDeepCompareEffect } from 'react-use';

import { deletePluginMetadataReq, putPluginMetadataReq } from '@/apis/plugins';
import type { PluginCardProps } from '@/components/form-slice/FormItemPlugins/PluginCard';
import {
  PluginCardList,
  PluginCardListSearch,
} from '@/components/form-slice/FormItemPlugins/PluginCardList';
import {
  type PluginConfig,
  PluginEditorDrawer,
} from '@/components/form-slice/FormItemPlugins/PluginEditorDrawer';
import { SelectPluginsDrawer } from '@/components/form-slice/FormItemPlugins/SelectPluginsDrawer';
import { usePermission } from '@/hooks/usePermission';

import { type PluginInfo, usePluginMetadataList } from './hooks';

export const PluginMetadata = () => {
  const { t } = useTranslation();
  // A viewer reads plugin metadata since #176 but cannot write it — the
  // backend refuses every non-GET — so the page offers them somewhere to look
  // rather than Edit, Delete and Select Plugins, all of which it knows will
  // fail. The same gating every other resource page applies (#178).
  const { canEdit } = usePermission();

  const getMetadataListReq = usePluginMetadataList();
  const putMetadata = useMutation({
    mutationFn: putPluginMetadataReq,
    onSuccess(_, variables) {
      notifications.show({
        message: t('info.edit.success', {
          name: `${t('pluginMetadata.singular')} of ${variables.name}`,
        }),
        color: 'green',
      });
      getMetadataListReq.refetch();
    },
  });
  const deleteMetadata = useMutation({
    mutationFn: (name: string) => deletePluginMetadataReq(name),
    onSuccess(_, name) {
      notifications.show({
        message: t('info.delete.success', {
          name: `${t('pluginMetadata.singular')} of ${name}`,
        }),
        color: 'green',
      });
      getMetadataListReq.refetch();
    },
  });

  const pluginsOb = useLocalObservable(() => ({
    __map: new Map<string, PluginConfig>(),
    __schemaMap: new Map<string, object>(),
    init(map: Map<string, PluginInfo>, hasConfigNames: string[]) {
      // we need to clear the map first
      this.__map.clear();
      this.__schemaMap.clear();
      this.allPluginNames = [];
      for (const [name, info] of map.entries()) {
        if (hasConfigNames.includes(name)) {
          this.__map.set(name, info);
        }
        this.__schemaMap.set(name, info.schema);
        this.allPluginNames.push(name);
      }
    },
    delete(name: string) {
      deleteMetadata.mutateAsync(name);
    },
    update(config: PluginConfig) {
      putMetadata.mutateAsync(config);
    },
    allPluginNames: [] as string[],
    get selected() {
      return Array.from(this.__map.keys());
    },
    get unSelected() {
      return difference(this.allPluginNames, this.selected);
    },
    curPlugin: {} as PluginConfig,
    curPluginSchema: {} as object,
    setCurPlugin(name: string) {
      this.curPlugin = this.__map.get(name) || { name, config: {} };
      this.curPluginSchema = this.__schemaMap.get(name)!;
      this.setEditorOpened(true);
    },
    editorOpened: false,
    setEditorOpened(val: boolean) {
      this.editorOpened = val;
    },
    closeEditor() {
      this.setEditorOpened(false);
      this.setSelectPluginsOpened(false);
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

  const { pluginInfoMap, hasConfigNames, isLoading, isForbidden } =
    getMetadataListReq;
  // init the selected plugins
  useDeepCompareEffect(() => {
    if (isLoading) return;
    pluginsOb.init(pluginInfoMap, hasConfigNames);
  }, [pluginInfoMap, hasConfigNames, pluginsOb, isLoading]);

  return (
    <Drawer.Stack>
      {/* Until the instance's metadata has arrived. Without it, a slow
          gateway reads as one with nothing configured. */}
      {isLoading && (
        <Center py="md" data-testid="plugin-metadata-loading">
          <Loader size="sm" />
        </Center>
      )}
      {isForbidden && (
        <Alert color="yellow" variant="light" mb="md">
          {t('pluginMetadata.forbidden')}
        </Alert>
      )}
      <Group>
        <PluginCardListSearch
          search={pluginsOb.search}
          setSearch={pluginsOb.setSearch}
        />
        {/* Always mounted, even for a viewer: drawers share one portal and
            one z-index, so mount order decides which is on top. Mounted only
            for a writer, it came in after the plugin editor whenever the role
            changed under the mounted page, and sat over the Add Plugin drawer
            it opens. An instance switch no longer does that — the route
            remounts the page per instance (#180) — but the role still can,
            when the account's instance roles arrive after the page has
            mounted. SelectPluginsDrawer asks for `disabled` for exactly this
            reason; `disabled` hides its button. */}
        <SelectPluginsDrawer
          plugins={pluginsOb.unSelected}
          onAdd={(name) => pluginsOb.on('add', name)}
          opened={pluginsOb.selectPluginsOpened}
          setOpened={pluginsOb.setSelectPluginsOpened}
          disabled={!canEdit}
        />
      </Group>
      <PluginCardList
        mode={canEdit ? 'edit' : 'view'}
        placeholder={t('pluginMetadata.search')}
        mah="60vh"
        search={pluginsOb.search}
        plugins={pluginsOb.selected}
        // Always passed; only `mode` is gated. PluginCardList keeps the
        // handlers from its first render — a mobx observable's initializer
        // closes over them, and only `mode` is resynced afterwards — so a
        // handler withheld while the role was viewer stayed undefined once the
        // role changed under the mounted page: Edit and Delete shown, and
        // inert. An instance switch now remounts the page (#180); the
        // account's instance roles arriving after mount still change the role
        // under it. PluginCard renders them in 'edit' mode only, so a viewer
        // still never reaches them.
        onDelete={pluginsOb.delete}
        onEdit={(name) => pluginsOb.on('edit', name)}
        // 'view' opens the same drawer read-only: fields disabled and no
        // save button (PluginEditorDrawer), so there is nothing to submit.
        onView={(name) => pluginsOb.on('view', name)}
      />
      <PluginEditorDrawer
        mode={pluginsOb.mode}
        schema={toJS(pluginsOb.curPluginSchema)}
        opened={pluginsOb.editorOpened}
        onClose={pluginsOb.closeEditor}
        plugin={toJS(pluginsOb.curPlugin)}
        onSave={pluginsOb.update}
      />
    </Drawer.Stack>
  );
};
