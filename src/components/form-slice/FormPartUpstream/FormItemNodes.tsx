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
  Button,
  Flex,
  InputWrapper,
  Stack,
  Text,
} from '@mantine/core';
import { path } from 'rambdax';
import { useEffect, useMemo } from 'react';
import {
  type Control,
  type FieldValues,
  type Path,
  type UseControllerProps,
  useFieldArray,
  useFormState,
  useWatch,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemTextInput } from '@/components/form/TextInput';
import type { APISIXType } from '@/types/schema/apisix';

import { genControllerProps } from '../../form/util';
import { genRecord, parseToNodes } from './node-rows';

export type FormItemNodesProps<T extends FieldValues> = UseControllerProps<T> & {
  defaultValue?: APISIXType['UpstreamNode'][];
  label?: React.ReactNode;
  description?: React.ReactNode;
  required?: boolean;
  withAsterisk?: boolean;
};

/**
 * The node editor: the rows of an upstream's `nodes`.
 *
 * The form owns the list, through `useFieldArray`, which keys each row on an
 * id of its own that survives every write. An earlier version kept a copy of
 * the list beside the form and reconciled the two on each commit, which is
 * where #306 (a row rebuilt under the caret) and #303 (a weight of 0 nobody
 * asked for) lived.
 */
export const FormItemNodes = <T extends FieldValues>(
  props: FormItemNodesProps<T>
) => {
  const { controllerProps } = useMemo(
    () => genControllerProps(props),
    // genControllerProps reads these; `props` itself is a new object on every
    // render, and memoising on it memoises nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.name, props.control, props.defaultValue, props.disabled]
  );
  const { t } = useTranslation();
  const { label, description, required } = props;

  const { control, name } = controllerProps;
  // The field array owns this name. Registering it a second time, through a
  // controller, made react-hook-form file the list's own error under `root`
  // instead of on the field, and "At least one node is required" then had
  // nowhere to render - the silence of #313, one level up.
  const { fields, append, remove, replace } = useFieldArray({
    control: control as never,
    name: name as never,
  });
  const { errors, disabled: formDisabled } = useFormState({ control, name });
  // The form's flag, or this editor's own: a caller may disable the list
  // alone, and useController used to answer for both.
  const disabled = formDisabled || props.disabled;
  const error = path(name, errors) as
    | { message?: string; root?: { message?: string } }
    | undefined;
  const value = useWatch({ control, name });

  // APISIX stores nodes either as a list or as `{"host:port": weight}`, and a
  // detail page hands the form whichever it got. The list is what the form
  // holds, what `useFieldArray` needs, and what everything else reads - the
  // connection test is offered nothing by an object.
  useEffect(() => {
    if (value && !Array.isArray(value)) {
      replace(parseToNodes(value) as never);
    }
  }, [value, replace]);

  const fieldName = (index: number, key: string) =>
    `${name}.${index}.${key}` as Path<T>;

  return (
    <InputWrapper
      error={error?.message ?? error?.root?.message}
      label={label}
      description={description}
      required={required}
    >
      <Stack gap="xs" mt="xs">
        {fields.map((row, index) => (
          <Flex key={row.id} gap="sm" align="center" wrap="wrap">
            <Text size="sm" mb={0}>
              <Text span c="red">
                *{' '}
              </Text>
              {t('form.upstreams.nodes.host.title', 'Host')}:
            </Text>
            <FormItemTextInput
              control={control as Control<T>}
              name={fieldName(index, 'host')}
              placeholder="Hostname or IP"
              disabled={disabled}
              style={{ flex: 2, minWidth: 150 }}
            />

            <Text size="sm" mb={0}>
              {t('form.upstreams.nodes.port.title', 'Port')}:
            </Text>
            <FormItemNumberInput
              control={control as Control<T>}
              name={fieldName(index, 'port')}
              placeholder="Port"
              disabled={disabled}
              min={1}
              max={65535}
              allowDecimal={false}
              style={{ flex: 1, minWidth: 80 }}
            />

            <Text size="sm" mb={0}>
              <Text span c="red">
                *{' '}
              </Text>
              {t('form.upstreams.nodes.weight.title', 'Weight')}:
            </Text>
            <FormItemNumberInput
              control={control as Control<T>}
              name={fieldName(index, 'weight')}
              placeholder="1"
              disabled={disabled}
              min={0}
              allowDecimal={false}
              style={{ flex: 1, minWidth: 80 }}
            />

            {!disabled && (
              <ActionIcon
                variant="subtle"
                color="gray"
                radius="xl"
                aria-label={t('form.upstreams.nodes.remove', 'Remove node')}
                onClick={() => remove(index)}
              >
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>-</span>
              </ActionIcon>
            )}
          </Flex>
        ))}
      </Stack>
      {!disabled && (
        <Button
          variant="light"
          size="sm"
          mt="sm"
          leftSection={
            <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>+</span>
          }
          onClick={() => append(genRecord() as never)}
        >
          {t('form.upstreams.nodes.add', 'Add a Node')}
        </Button>
      )}
    </InputWrapper>
  );
};
