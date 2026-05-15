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
import { nanoid } from 'nanoid';
import { equals, isNil } from 'rambdax';
import { useEffect, useMemo } from 'react';
import { type FieldValues, useController, type UseControllerProps } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { zGetDefault } from '@/utils/zod';

import { genControllerProps } from '../../form/util';

type DataSource = APISIXType['UpstreamNode'] & APISIXType['ID'];

const genRecord = (data?: DataSource | APISIXType['UpstreamNode']) => {
  const d = data || zGetDefault(APISIX.UpstreamNode);
  return {
    id: nanoid(),
    ...d,
    weight: d.weight ?? 1,
  } as DataSource;
};

const objToUpstreamNodes = (data: APISIXType['UpstreamNodeObj']) => {
  return Object.entries(data).map(([key, val]) => {
    const [host, port] = key.split(':');
    const d: APISIXType['UpstreamNode'] = {
      host,
      port: Number(port) || 1,
      weight: val,
      priority: 0,
    };
    return d;
  });
};

const parseToDataSource = (data: APISIXType['UpstreamNodeListOrObj']) => {
  let val: APISIXType['UpstreamNodes'];
  if (isNil(data)) val = [];
  else if (Array.isArray(data)) val = data as APISIXType['UpstreamNodes'];
  else val = objToUpstreamNodes(data as APISIXType['UpstreamNodeObj']);
  return val.map(genRecord);
};

const parseToUpstreamNodes = (data: DataSource[] | undefined) => {
  if (!data?.length) return [];
  return data.map((item) => {
    const d: APISIXType['UpstreamNode'] = {
      host: item.host,
      port: item.port,
      weight: item.weight,
      priority: item.priority,
    };
    return d;
  });
};

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
    setValues(data: DataSource[]) {
      if (equals(toJS(this.values), data)) return;
      this.values = data;
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
    ob.setValues(parseToDataSource(value));
  }, [ob, value]);

  useEffect(() => {
    ob.setDisabled(disabled);
  }, [disabled, ob]);

  const commitChanges = () => {
    const vals = parseToUpstreamNodes(toJS(ob.values));
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
