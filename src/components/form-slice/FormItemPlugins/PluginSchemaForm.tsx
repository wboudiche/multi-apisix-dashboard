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
  ActionIcon,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';

import IconAdd from '~icons/material-symbols/add';
import IconDelete from '~icons/material-symbols/delete-outline';
import IconHelp from '~icons/material-symbols/help-outline';

type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
};

type PluginSchemaFormProps = {
  schema: JSONSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
};

const FieldLabel = ({ name, required, description }: { name: string; required?: boolean; description?: string }) => (
  <Group gap={4} wrap="nowrap">
    <Text size="sm" fw={required ? 600 : 400}>
      {required && <Text component="span" c="red" fw={700}>* </Text>}
      {name}
    </Text>
    {description && (
      <Tooltip label={description} multiline maw={300} withArrow>
        <IconHelp width="14" height="14" style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
      </Tooltip>
    )}
  </Group>
);

const ArrayOfStringsField = ({
  name,
  value,
  onChange,
  description,
  required,
  disabled,
}: {
  name: string;
  value: string[];
  onChange: (val: string[]) => void;
  description?: string;
  required?: boolean;
  disabled?: boolean;
}) => (
  <TagsInput
    label={<FieldLabel name={name} required={required} description={description} />}
    value={value}
    onChange={onChange}
    disabled={disabled}
  />
);

const ArrayOfObjectsField = ({
  name,
  value,
  onChange,
  itemSchema,
  description,
  required,
  disabled,
}: {
  name: string;
  value: Record<string, unknown>[];
  onChange: (val: Record<string, unknown>[]) => void;
  itemSchema: JSONSchema;
  description?: string;
  required?: boolean;
  disabled?: boolean;
}) => {
  const props = itemSchema.properties || {};
  const propKeys = Object.keys(props);

  return (
    <Stack gap="xs">
      <FieldLabel name={name} required={required} description={description} />
      {value.map((item, idx) => (
        <Group key={idx} gap="xs" align="flex-end">
          {propKeys.map((key) => {
            const prop = props[key];
            const fieldType = prop.type;
            const fieldVal = item[key];

            if (fieldType === 'integer' || fieldType === 'number') {
              return (
                <NumberInput
                  key={key}
                  label={key}
                  size="xs"
                  value={(fieldVal as number) ?? ''}
                  onChange={(v) => {
                    const next = [...value];
                    next[idx] = { ...next[idx], [key]: v === '' ? undefined : v };
                    onChange(next);
                  }}
                  min={prop.minimum}
                  max={prop.maximum}
                  disabled={disabled}
                  style={{ flex: 1 }}
                />
              );
            }

            return (
              <TextInput
                key={key}
                label={key}
                size="xs"
                value={String(fieldVal ?? '')}
                onChange={(e) => {
                  const next = [...value];
                  next[idx] = { ...next[idx], [key]: e.currentTarget.value };
                  onChange(next);
                }}
                disabled={disabled}
                style={{ flex: 1 }}
              />
            );
          })}
          {!disabled && (
            <ActionIcon color="red" variant="subtle" onClick={() => onChange(value.filter((_, i) => i !== idx))}>
              <IconDelete width="16" height="16" />
            </ActionIcon>
          )}
        </Group>
      ))}
      {!disabled && (
        <Group>
          <ActionIcon
            variant="light"
            onClick={() => {
              const defaults: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(props)) {
                if (v.default !== undefined) defaults[k] = v.default;
              }
              onChange([...value, defaults]);
            }}
          >
            <IconAdd width="16" height="16" />
          </ActionIcon>
        </Group>
      )}
    </Stack>
  );
};

const SchemaField = ({
  name,
  schema,
  value,
  onChange,
  required,
  disabled,
}: {
  name: string;
  schema: JSONSchema;
  value: unknown;
  onChange: (val: unknown) => void;
  required?: boolean;
  disabled?: boolean;
}) => {
  const type = schema.type;
  const description = schema.description;

  // Skip internal _meta field
  if (name === '_meta') return null;

  // Enum → Select
  if (schema.enum && schema.enum.length > 0) {
    return (
      <Select
        label={<FieldLabel name={name} required={required} description={description} />}
        data={schema.enum.map((v) => ({ value: String(v), label: String(v) }))}
        value={value !== undefined && value !== null ? String(value) : null}
        onChange={(val) => {
          if (val === null) {
            onChange(undefined);
            return;
          }
          // Try to preserve original type
          if (type === 'integer' || type === 'number') {
            onChange(Number(val));
          } else {
            onChange(val);
          }
        }}
        clearable
        disabled={disabled}
      />
    );
  }

  // Boolean → Switch
  if (type === 'boolean') {
    return (
      <Group gap="sm">
        <FieldLabel name={name} required={required} description={description} />
        <Switch
          checked={value === true}
          onChange={(e) => onChange(e.currentTarget.checked)}
          disabled={disabled}
        />
      </Group>
    );
  }

  // Integer/Number → NumberInput
  if (type === 'integer' || type === 'number') {
    return (
      <NumberInput
        label={<FieldLabel name={name} required={required} description={description} />}
        value={(value as number) ?? ''}
        onChange={(v) => onChange(v === '' ? undefined : v)}
        min={schema.minimum}
        max={schema.maximum}
        step={type === 'integer' ? 1 : 0.1}
        disabled={disabled}
      />
    );
  }

  // Array
  if (type === 'array' && schema.items) {
    if (schema.items.type === 'string') {
      return (
        <ArrayOfStringsField
          name={name}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          description={description}
          required={required}
          disabled={disabled}
        />
      );
    }
    if (schema.items.type === 'object' && schema.items.properties) {
      return (
        <ArrayOfObjectsField
          name={name}
          value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
          onChange={onChange}
          itemSchema={schema.items}
          description={description}
          required={required}
          disabled={disabled}
        />
      );
    }
    // Fallback: array of other types → TagsInput with string conversion
    return (
      <ArrayOfStringsField
        name={name}
        value={Array.isArray(value) ? value.map(String) : []}
        onChange={onChange}
        description={description}
        required={required}
        disabled={disabled}
      />
    );
  }

  // Object → render nested (one level only to avoid complexity)
  if (type === 'object' && schema.properties) {
    const nestedRequired = new Set(schema.required || []);
    const obj = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    return (
      <Stack gap="xs" pl="md" style={{ borderLeft: '2px solid var(--mantine-color-gray-3)' }}>
        <FieldLabel name={name} required={required} description={description} />
        {Object.entries(schema.properties).map(([key, propSchema]) => (
          <SchemaField
            key={key}
            name={key}
            schema={propSchema}
            value={obj[key]}
            onChange={(v) => {
              const next = { ...obj };
              if (v === undefined || v === '' || v === null) {
                delete next[key];
              } else {
                next[key] = v;
              }
              onChange(Object.keys(next).length > 0 ? next : undefined);
            }}
            required={nestedRequired.has(key)}
            disabled={disabled}
          />
        ))}
      </Stack>
    );
  }

  // String (default) → TextInput
  return (
    <TextInput
      label={<FieldLabel name={name} required={required} description={description} />}
      value={value !== undefined && value !== null ? String(value) : ''}
      onChange={(e) => onChange(e.currentTarget.value || undefined)}
      disabled={disabled}
    />
  );
};

export const PluginSchemaForm = (props: PluginSchemaFormProps) => {
  const { schema, value: externalValue, onChange, disabled } = props;
  const [localValue, setLocalValue] = useState<Record<string, unknown>>(externalValue);

  // Sync from external
  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  const handleFieldChange = useCallback(
    (fieldName: string, fieldValue: unknown) => {
      setLocalValue((prev) => {
        const next = { ...prev };
        if (fieldValue === undefined || fieldValue === '' || fieldValue === null) {
          delete next[fieldName];
        } else {
          next[fieldName] = fieldValue;
        }
        onChange(next);
        return next;
      });
    },
    [onChange]
  );

  const properties = schema.properties || {};
  const requiredSet = new Set(schema.required || []);

  // Sort: required fields first, then alphabetical
  const sortedKeys = Object.keys(properties).sort((a, b) => {
    const aReq = requiredSet.has(a) ? 0 : 1;
    const bReq = requiredSet.has(b) ? 0 : 1;
    if (aReq !== bReq) return aReq - bReq;
    return a.localeCompare(b);
  });

  return (
    <Stack gap="sm">
      {sortedKeys.map((key) => (
        <SchemaField
          key={key}
          name={key}
          schema={properties[key]}
          value={localValue[key]}
          onChange={(v) => handleFieldChange(key, v)}
          required={requiredSet.has(key)}
          disabled={disabled}
        />
      ))}
    </Stack>
  );
};
