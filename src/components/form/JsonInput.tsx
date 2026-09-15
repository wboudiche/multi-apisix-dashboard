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
import { JsonInput, type JsonInputProps } from '@mantine/core';
import { omit } from 'rambdax';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
} from 'react-hook-form';

import { genControllerProps } from './util';

export type FormItemJsonInputProps<T extends FieldValues> = UseControllerProps<T> &
  JsonInputProps & {
    toObject?: boolean;
    objValue?: unknown;
  };

/** An object as the text the input shows; '' for the placeholder object. */
const toJsonText = (val: unknown, placeholder: unknown) => {
  const text = JSON.stringify(val, null, 2);
  return text === JSON.stringify(placeholder) ? '' : text;
};

export const FormItemJsonInput = <T extends FieldValues>(
  props: FormItemJsonInputProps<T>
) => {
  const { objValue = {} } = props;
  const {
    controllerProps,
    restProps: { toObject, ...restProps },
  } = genControllerProps(props, props.toObject ? objValue : '');
  const {
    field: { value: rawVal, onChange: fOnChange, ...restField },
    fieldState,
  } = useController<T>(controllerProps);
  // Worked out on each render: objValue defaults to a new {} every time, so a
  // memo keyed on it never hit, and the React compiler cannot keep one whose
  // dependency is handed to genControllerProps above.
  const value = !toObject || typeof rawVal === 'string' ? rawVal : toJsonText(rawVal, objValue);

  return (
    <JsonInput
      value={value}
      error={fieldState.error?.message}
      onChange={(val) => {
        let res: unknown;
        if (toObject) {
          try {
            res = JSON.parse(val);
          } catch {
            res = val.length === 0 ? objValue : val;
          }
        }
        fOnChange(res);
        restProps.onChange?.(val);
      }}
      formatOnBlur
      autosize
      resize="vertical"
      {...restField}
      {...omit(['objValue'], restProps)}
    />
  );
};
