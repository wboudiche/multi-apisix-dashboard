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
import { ActionIcon, Button, Flex, InputWrapper, NumberInput, Stack,Text, TextInput } from '@mantine/core';
import { useClickOutside } from '@mantine/hooks';
import { toJS } from 'mobx';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { equals } from 'rambdax';
import { useEffect, useMemo } from 'react';
import { type FieldValues, useController, type UseControllerProps } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { type APISIXType } from '@/types/schema/apisix';

import { genControllerProps } from '../../form/util';
import {
  type DataSource,
  genRecord,
  mergeRowIds,
  parseToNodes,
  parseToUpstreamNodes,
  rowNodes,
} from './node-rows';

export type FormItemNodesProps<T extends FieldValues> = UseControllerProps<T> & {
  onChange?: (value: APISIXType['UpstreamNode'][]) => void;
  defaultValue?: APISIXType['UpstreamNode'][];
  label?: React.ReactNode;
  description?: React.ReactNode;
  required?: boolean;
  withAsterisk?: boolean;
};

export const FormItemNodes = observer(<T extends FieldValues>(props: FormItemNodesProps<T>) => {
  const { controllerProps, restProps } = useMemo(() => genControllerProps(props), [props]);
  const { t } = useTranslation();
  const {
    field: { value, onChange: fOnChange, name: fName, disabled },
    fieldState,
  } = useController<T>(controllerProps);

  const { label, description, required } = props;
  const ob = useLocalObservable(() => ({
    disabled: false,
    setDisabled(disabled: boolean | undefined) {
      this.disabled = disabled || false;
    },
    values: [] as DataSource[],
    setValues(nodes: APISIXType['UpstreamNode'][]) {
      // The rows already say this: leave them, and their ids, alone. This is
      // the common case, since the value being read here is usually the one
      // these rows committed a moment ago.
      //
      // Compare what the rows hold, not what they would commit: a row whose
      // Weight box is empty commits a 1, and comparing that 1 to the value's
      // 1 would call them equal and leave the box blank while 1 is what gets
      // saved.
      const rows = toJS(this.values);
      if (equals(rowNodes(rows), nodes)) return;
      this.values = mergeRowIds(rows, nodes);
    },
    append(data: DataSource) {
      this.values.push(data);
    },
    remove(id: string) {
      const index = this.values.findIndex((item) => item.id === id);
      if (index === -1) return;
      this.values.splice(index, 1);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateValue(id: string, field: keyof DataSource, val: any) {
      const index = this.values.findIndex((item) => item.id === id);
      if (index === -1) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.values[index] as any)[field] = val;
    }
  }));

  useEffect(() => {
    ob.setValues(parseToNodes(value));
  }, [ob, value]);

  useEffect(() => {
    ob.setDisabled(disabled);
  }, [disabled, ob]);

  const commitChanges = () => {
    const rows = toJS(ob.values);
    const vals = parseToUpstreamNodes(rows);
    // Put the repair on screen too. A Weight box left empty commits a 1, and
    // a box that says nothing while 1 is what gets saved is the same
    // disagreement as the one this editor exists to avoid - the form value
    // may well be equal to what it already held, so nothing would come back
    // through the sync to fill it.
    if (!equals(rowNodes(rows), vals)) ob.setValues(vals);
    // Say nothing when there is nothing to say. useClickOutside listens on
    // four events, so one click outside used to write four fresh arrays to
    // the form: each re-entered the sync above, and each marked a form
    // nobody had edited as dirty. A form with no nodes at all has nothing to
    // hear from an empty editor either.
    //
    // A value still in APISIX's object form is not "nothing to say", however
    // equal its nodes read: the form holds a list, and what reads it - the
    // connection test, for one - is offered nothing by an object. That is
    // also why a read-only editor still commits: a detail page is where the
    // object form arrives, and it is read-only until Edit is pressed.
    if (Array.isArray(value) ? equals(vals, value) : vals.length === 0) return;
    if (disabled && Array.isArray(value)) return;
    fOnChange?.(vals);
    restProps.onChange?.(vals);
  };

  const ref = useClickOutside(() => {
    commitChanges();
  }, ['mouseup', 'touchend', 'mousedown', 'touchstart']);

  return (
    <InputWrapper
      error={fieldState.error?.message}
      label={label}
      description={description}
      required={required}
      ref={ref}
    >
      <input name={fName} type="hidden" />
      <Stack gap="xs" mt="xs">
        {ob.values.map((item) => (
          <Flex key={item.id} gap="sm" align="center" wrap="wrap">
            <Text size="sm" mb={0}><Text span c="red">* </Text>{t('form.upstreams.nodes.host.title', 'Host')}:</Text>
            <TextInput
              placeholder="Hostname or IP"
              value={item.host || ''}
              onChange={(e) => ob.updateValue(item.id, 'host', e.target.value)}
              onBlur={commitChanges}
              disabled={ob.disabled}
              style={{ flex: 2, minWidth: 150 }}
            />

            <Text size="sm" mb={0}>{t('form.upstreams.nodes.port.title', 'Port')}:</Text>
            <NumberInput
              placeholder="Port"
              value={item.port}
              onChange={(v) => ob.updateValue(item.id, 'port', v === '' ? undefined : Number(v))}
              onBlur={commitChanges}
              disabled={ob.disabled}
              min={1}
              max={65535}
              allowDecimal={false}
              style={{ flex: 1, minWidth: 80 }}
            />

            <Text size="sm" mb={0}><Text span c="red">* </Text>{t('form.upstreams.nodes.weight.title', 'Weight')}:</Text>
            <NumberInput
              placeholder="1"
              value={item.weight}
              onChange={(v) => ob.updateValue(item.id, 'weight', v === '' ? undefined : Number(v))}
              onBlur={commitChanges}
              disabled={ob.disabled}
              min={0}
              allowDecimal={false}
              style={{ flex: 1, minWidth: 80 }}
            />

            {!ob.disabled && (
              <ActionIcon
                variant="subtle"
                color="gray"
                radius="xl"
                onClick={() => {
                  ob.remove(item.id);
                  commitChanges();
                }}
              >
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>-</span>
              </ActionIcon>
            )}
          </Flex>
        ))}
      </Stack>
      {!ob.disabled && (
        <Button
          variant="light"
          size="sm"
          mt="sm"
          leftSection={<span style={{ fontSize: '1.1rem', fontWeight: 600 }}>+</span>}
          onClick={() => {
            ob.append(genRecord());
            commitChanges();
          }}
        >
          {t('form.upstreams.nodes.add', 'Add a Node')}
        </Button>
      )}
    </InputWrapper>
  );
});
