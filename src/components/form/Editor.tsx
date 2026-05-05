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
import { InputWrapper, type InputWrapperProps, Skeleton } from '@mantine/core';
import { Editor } from '@monaco-editor/react';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FieldValues,
  useController,
  type UseControllerProps,
  useFormContext,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { monaco, setupMonacoEditor } from '@/utils/monaco';

import { genControllerProps } from './util';

setupMonacoEditor();

type FormItemEditorProps<T extends FieldValues> = InputWrapperProps &
  UseControllerProps<T> & {
    language?: string;
    isLoading?: boolean;
    customSchema?: object;
  };
export const FormItemEditor = <T extends FieldValues>(
  props: FormItemEditorProps<T>
) => {
  const { t } = useTranslation();
  const { controllerProps, restProps } = genControllerProps(props, '');
  const { customSchema, language, isLoading, ...wrapperProps } = restProps;
  const { trigger } = useFormContext();
  const monacoErrorRef = useRef<string | null>(null);
  const enhancedControllerProps = useMemo(() => {
    return {
      ...controllerProps,
      rules: {
        ...controllerProps.rules,
        validate: (value: string) => {
          // Check JSON syntax
          try {
            JSON.parse(value);
          } catch {
            return t('form.json.parseError');
          }
          // Check Monaco markers
          if (monacoErrorRef.current) {
            return monacoErrorRef.current;
          }
          return true;
        },
      },
    };
  }, [controllerProps, t, monacoErrorRef]);

  const {
    field: { value, onChange: fOnChange, ...restField },
    fieldState,
  } = useController<T>(enhancedControllerProps);

  const [internalLoading, setLoading] = useState(false);
  const lineHeight = 25;
  const paddingVertical = 20;
  const minLines = 3;
  const maxLines = 20;
  const lineCount = useMemo(() => {
    if (!value) return minLines;
    const lines = String(value).split('\n').length;
    return Math.max(minLines, Math.min(lines, maxLines));
  }, [value]);
  const editorHeight = lineCount * lineHeight + paddingVertical;

  useEffect(() => {
    setLoading(true);

    const schemas = [];
    if (customSchema) {
      schemas.push({
        uri: 'https://apisix.apache.org',
        fileMatch: ['*'],
        schema: customSchema,
      });
    }
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas,
      trailingCommas: 'error',
      enableSchemaRequest: false,
    });

    setLoading(false);
  }, [customSchema]);

  const options = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
    minimap: { enabled: false },
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 12,
    lineNumbersMinChars: 0,
    renderLineHighlight: 'none',
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    lineHeight: 25,
    fontWeight: '400',
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
      handleMouseWheel: true,
    },
    padding: {
      top: 10,
      bottom: 10,
    },
  }), []);

  return (
    <InputWrapper
      error={fieldState.error?.message}
      id="editor-wrapper"
      {...wrapperProps}
    >
      <input name={restField.name} type="hidden" />
      {(isLoading || internalLoading) && (
        <Skeleton
          style={{
            position: 'absolute',
            zIndex: 1,
            top: 0,
            left: 0,
          }}
          data-testid="editor-loading"
          visible
          height="100%"
          width="100%"
        />
      )}
      <Editor
        height={`${editorHeight}px`}
        wrapperProps={{
          className: clsx(
            'editor-wrapper',
            restField.disabled && 'editor-wrapper--disabled'
          )
        }}
        defaultValue={controllerProps.defaultValue}
        value={value}
        onChange={fOnChange}
        onValidate={(markers) => {
          monacoErrorRef.current = markers?.[0]?.message || null;
          trigger(props.name);
        }}
        onMount={() => {
          // Trigger layout once mounted
        }}
        loading={
          <Skeleton
            data-testid="editor-loading"
            visible
            height={`${editorHeight}px`}
            width="100%"
          />
        }
        options={{ ...options, readOnly: !!restField.disabled }}
        defaultLanguage="json"
        {...(language && { language })}
      />
    </InputWrapper>
  );
};
