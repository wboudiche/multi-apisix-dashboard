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
  Badge,
  Button,
  Code,
  Collapse,
  Drawer,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { isEmpty, isNil } from 'rambdax';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormItemEditor } from '@/components/form/Editor';
import type { PluginConfigValue } from '@/utils/plugin-priority';
import { withPriority } from '@/utils/plugin-priority';
import IconChevronRight from '~icons/material-symbols/chevron-right';
import IconExpandMore from '~icons/material-symbols/expand-more';

import type { PluginCardListProps } from './PluginCardList';
import {
  CATEGORY_COLORS,
  getPluginCategory,
  getPluginDescription,
} from './pluginMetadata';
import { PluginSchemaForm } from './PluginSchemaForm';
import { PLUGIN_TEMPLATES } from './pluginTemplates';

export type PluginConfig = { name: string; config: object };
export type PluginEditorDrawerProps = Pick<PluginCardListProps, 'mode'> & {
  opened: boolean;
  onClose: () => void;
  onSave: (props: PluginConfig) => void;
  plugin: PluginConfig;
  schema?: object;
  /**
   * Whether to offer the execution priority at all.
   *
   * This drawer also edits plugin metadata, which is a plugin's own settings
   * on the gateway and has no `_meta` and no order to speak of: the field
   * would have written `_meta.priority` into a body validated against the
   * metadata schema. Opt-in, rather than inferred from defaultPriority, which
   * is absent precisely when the page should still say it does not know (#48).
   */
  showPriority?: boolean;
  /**
   * What the gateway says this plugin runs at when the route says nothing
   * (#48). Undefined for a plugin it does not list, and the field says so
   * rather than offering a number nobody here knows.
   */
  defaultPriority?: number;
};

const isEmptyConfig = (p: object): boolean => isEmpty(p) || isNil(p);

const toConfigStr = (p: object): string => {
  return !isEmptyConfig(p) ? JSON.stringify(p, null, 2) : '{}';
};

const getDefaultConfig = (name: string, config: object): string => {
  if (!isEmptyConfig(config)) return toConfigStr(config);
  const template = PLUGIN_TEMPLATES.find((tpl) => tpl.plugin === name);
  if (template && !isEmpty(template.config)) {
    return JSON.stringify(template.config, null, 2);
  }
  return '{}';
};

const getDefaultConfigObj = (name: string, config: object): Record<string, unknown> => {
  if (!isEmptyConfig(config)) return config as Record<string, unknown>;
  const template = PLUGIN_TEMPLATES.find((tpl) => tpl.plugin === name);
  if (template && !isEmpty(template.config)) {
    return template.config as Record<string, unknown>;
  }
  return {};
};

type SchemaObj = {
  description?: string;
  required?: string[];
  properties?: Record<
    string,
    { type?: string; description?: string; default?: unknown; enum?: unknown[] }
  >;
};

const hasFormableProperties = (schema: SchemaObj | undefined): schema is SchemaObj => {
  if (!schema?.properties) return false;
  return Object.keys(schema.properties).some((k) => k !== '_meta');
};

const SchemaHints = ({ schema, name }: { schema: SchemaObj; name: string }) => {
  const { t } = useTranslation();
  const [exampleOpened, { toggle: toggleExample }] = useDisclosure(false);

  const template = PLUGIN_TEMPLATES.find((tpl) => tpl.plugin === name);

  const requiredFields = useMemo(() => {
    const req = schema?.required || [];
    const props = schema?.properties || {};
    return req.map((field) => {
      const prop = props[field];
      const type = prop?.type || 'any';
      const enumVals = prop?.enum;
      return { field, type, enumVals };
    });
  }, [schema]);

  if (requiredFields.length === 0 && !template) return null;

  return (
    <Stack gap="xs" mb="sm">
      {requiredFields.length > 0 && (
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={4}>
            {t('form.plugins.requiredFields')}
          </Text>
          <Stack gap={2}>
            {requiredFields.map((f) => (
              <Group key={f.field} gap={4} wrap="nowrap">
                <Code style={{ fontSize: '11px', padding: '1px 4px' }}>
                  {f.field}
                </Code>
                <Badge size="xs" variant="outline" color="gray">
                  {f.type}
                </Badge>
                {f.enumVals && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {f.enumVals.join(' | ')}
                  </Text>
                )}
              </Group>
            ))}
          </Stack>
        </div>
      )}

      {template && (
        <div>
          <UnstyledButton onClick={toggleExample}>
            <Group gap={4}>
              {exampleOpened ? (
                <IconExpandMore width="14" height="14" />
              ) : (
                <IconChevronRight width="14" height="14" />
              )}
              <Text size="xs" fw={600} c="dimmed">
                {t('form.plugins.exampleConfig')}
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={exampleOpened}>
            <Code
              block
              mt={4}
              style={{ fontSize: '11px', lineHeight: 1.5, maxHeight: 120, overflow: 'auto' }}
            >
              {JSON.stringify(template.config, null, 2)}
            </Code>
          </Collapse>
        </div>
      )}
    </Stack>
  );
};

export const PluginEditorDrawer = (props: PluginEditorDrawerProps) => {
  const {
    opened,
    onSave,
    onClose,
    plugin,
    mode,
    schema,
    showPriority,
    defaultPriority,
  } = props;
  const { name, config } = plugin;
  const { t } = useTranslation();
  const schemaObj = schema as SchemaObj | undefined;
  const canShowForm = hasFormableProperties(schemaObj);

  const [editorMode, setEditorMode] = useState<string>(canShowForm ? 'form' : 'json');
  const [formValue, setFormValue] = useState<Record<string, unknown>>(() =>
    getDefaultConfigObj(name, config)
  );

  const methods = useForm<{ config: string }>({
    criteriaMode: 'all',
    disabled: mode === 'view',
    defaultValues: { config: getDefaultConfig(name, config) },
  });

  // Reset when the drawer is handed another plugin. Its own state follows
  // while rendering, compared with the plugin it last reset for; the JSON
  // field lives in react-hook-form, outside React state, and is still set from
  // an effect.
  const [lastPlugin, setLastPlugin] = useState({ name, config, canShowForm });
  if (
    lastPlugin.name !== name ||
    lastPlugin.config !== config ||
    lastPlugin.canShowForm !== canShowForm
  ) {
    setLastPlugin({ name, config, canShowForm });
    setFormValue(getDefaultConfigObj(name, config));
    setEditorMode(canShowForm ? 'form' : 'json');
  }

  useEffect(() => {
    methods.setValue('config', getDefaultConfig(name, config));
  }, [config, name, methods, canShowForm]);

  const handleClose = useCallback(() => {
    onClose();
    methods.reset();
  }, [onClose, methods]);

  // Sync form → JSON when switching to JSON mode
  const handleModeChange = useCallback(
    (newMode: string) => {
      if (newMode === 'json' && editorMode === 'form') {
        methods.setValue('config', JSON.stringify(formValue, null, 2));
      } else if (newMode === 'form' && editorMode === 'json') {
        try {
          const parsed = JSON.parse(methods.getValues('config'));
          setFormValue(parsed);
        } catch {
          // Invalid JSON, stay on JSON mode
          return;
        }
      }
      setEditorMode(newMode);
    },
    [editorMode, formValue, methods]
  );

  // The priority is edited in whichever half is on screen, rather than kept
  // beside it and merged on save: two places holding it would let a number
  // typed in the JSON be overwritten by a field that never saw it (#48).
  // useWatch rather than methods.watch: the repo's way of subscribing to a
  // field, and the one the React Compiler can follow.
  const configJson = useWatch({ control: methods.control, name: 'config' });
  // Read while rendering rather than memoised: it is one parse of a small
  // object, and useMemo over a react-hook-form watch is a subscription the
  // compiler cannot follow.
  const editedConfig = ((): PluginConfigValue | undefined => {
    if (editorMode === 'form') return formValue as PluginConfigValue;
    try {
      const parsed: unknown = JSON.parse(configJson);
      return parsed && typeof parsed === 'object'
        ? (parsed as PluginConfigValue)
        : undefined;
    } catch {
      // Half-typed JSON. The field goes quiet rather than guessing.
      return undefined;
    }
  })();

  const priority = editedConfig?._meta?.priority;

  const setPriority = useCallback(
    (next: number | undefined) => {
      if (!editedConfig) return;
      const applied = withPriority(editedConfig, next);
      if (editorMode === 'form') {
        setFormValue(applied);
      } else {
        methods.setValue('config', JSON.stringify(applied, null, 2));
      }
    },
    [editedConfig, editorMode, methods]
  );

  const handleSave = useCallback(() => {
    if (editorMode === 'form') {
      onSave({ name, config: formValue });
    } else {
      const configStr = methods.getValues('config');
      onSave({ name, config: JSON.parse(configStr) });
    }
    handleClose();
  }, [editorMode, formValue, methods, name, onSave, handleClose]);

  const category = name ? getPluginCategory(name) : 'other';
  const categoryColor = CATEGORY_COLORS[category];
  const desc = name ? getPluginDescription(name, schemaObj?.description) : '';

  return (
    <Drawer
      offset={0}
      radius="md"
      position="right"
      size="lg"
      closeOnEscape={false}
      opened={opened}
      onClose={handleClose}
      styles={{ body: { paddingTop: '18px' } }}
      {...(mode === 'add' && { title: t('form.plugins.addPlugin') })}
      {...(mode === 'edit' && { title: t('form.plugins.editPlugin') })}
      {...(mode === 'view' && { title: t('form.plugins.viewPlugin') })}
    >
      <Group gap="sm" mb={6} align="center">
        <Title order={3}>
          {name}
        </Title>
        {name && (
          <Badge size="sm" variant="light" color={categoryColor}>
            {t(`form.plugins.category.${category}`)}
          </Badge>
        )}
      </Group>

      {desc && (
        <Text size="sm" c="dimmed" mb="sm">
          {desc}
        </Text>
      )}

      {showPriority && (
      <NumberInput
        label={t('form.plugins.priority')}
        description={
          defaultPriority === undefined
            ? t('form.plugins.priorityHelpUnknown')
            : t('form.plugins.priorityHelp', { priority: defaultPriority })
        }
        placeholder={
          defaultPriority === undefined ? undefined : String(defaultPriority)
        }
        value={typeof priority === 'number' ? priority : ''}
        onChange={(value) => {
          if (value === '' || value === null) {
            setPriority(undefined);
            return;
          }
          // Mantine hands back a number once the input parses, and an empty
          // string until then. The guard is for anything else it might give:
          // a config is better left alone than handed a NaN, which serialises
          // to null and is refused by the Admin API.
          const parsed = typeof value === 'number' ? value : Number(value);
          if (Number.isFinite(parsed)) setPriority(parsed);
        }}
        disabled={mode === 'view' || !editedConfig}
        allowDecimal={false}
        mb="sm"
        data-testid="plugin-priority-input"
      />
      )}

      {/* Form / JSON toggle */}
      {canShowForm && (
        <SegmentedControl
          value={editorMode}
          onChange={handleModeChange}
          data={[
            { label: t('form.plugins.editorMode.form'), value: 'form' },
            { label: t('form.plugins.editorMode.json'), value: 'json' },
          ]}
          size="xs"
          mb="sm"
        />
      )}

      {editorMode === 'json' && schemaObj && name && (
        <SchemaHints schema={schemaObj} name={name} />
      )}

      {editorMode === 'form' && canShowForm ? (
        <>
          <ScrollArea.Autosize mah="65vh" type="scroll">
            <PluginSchemaForm
              schema={schemaObj}
              value={formValue}
              onChange={setFormValue}
              disabled={mode === 'view'}
            />
          </ScrollArea.Autosize>
          {mode !== 'view' && (
            <Button fullWidth mt="md" size="md" onClick={handleSave}>
              {mode === 'add' && t('form.btn.add')}
              {mode === 'edit' && t('form.btn.save')}
            </Button>
          )}
        </>
      ) : (
        <FormProvider {...methods}>
          <form>
            <FormItemEditor
              name="config"
              h={500}
              customSchema={schema}
              isLoading={!schema}
              required
            />
          </form>

          {mode !== 'view' && (
            <Button
              fullWidth
              mt="md"
              size="md"
              onClick={methods.handleSubmit(({ config: configStr }) => {
                onSave({ name, config: JSON.parse(configStr) });
                handleClose();
              })}
            >
              {mode === 'add' && t('form.btn.add')}
              {mode === 'edit' && t('form.btn.save')}
            </Button>
          )}
        </FormProvider>
      )}
    </Drawer>
  );
};
