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
import { type ComboboxItem, Stack } from '@mantine/core';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { APISIXType } from '@/types/schema/apisix';
import { APISIXCommon } from '@/types/schema/apisix/common';
import { useNamePrefix } from '@/utils/useNamePrefix';

import { FormItemLabels } from '../form/Labels';
import { LabelWithTooltip } from '../form/LabelWithTooltip';
import { FormItemSelect } from '../form/Select';
import { FormItemTextarea } from '../form/Textarea';
import { FormItemTextInput } from '../form/TextInput';
import { FormSection, type FormSectionProps } from './FormSection';
import { FormSectionGeneralContent } from './FormSectionGeneral';

const FormItemStatus = () => {
  const { control } = useFormContext<APISIXType['Basic']>();
  const { t } = useTranslation();
  const np = useNamePrefix();
  const options = useMemo(
    (): ComboboxItem[] =>
      APISIXCommon.Status.options.map((v) => ({
        value: String(v.value),
        label: t(`form.basic.statusOption.${v.value}`),
      })),
    [t]
  );
  return (
    <FormItemSelect
      control={control}
      name={np('status')}
      label={t('form.basic.status')}
      defaultValue={APISIXCommon.Status.options[1].value}
      data={options}
      from={String}
      to={Number}
    />
  );
};

export type FormPartBasicProps = Omit<FormSectionProps, 'form'> &
  PropsWithChildren & {
    before?: ReactNode;
    showStatus?: boolean;
    showName?: boolean;
    showDesc?: boolean;
    showLabels?: boolean;
    showGeneral?: boolean;
    namePlaceholder?: string;
    descPlaceholder?: string;
    nameTooltip?: string;
    descTooltip?: string;
  };

export const FormPartBasic = (props: FormPartBasicProps) => {
  const {
    before,
    children,
    showStatus = false,
    showName = true,
    showDesc = true,
    showLabels = true,
    showGeneral = false,
    namePlaceholder,
    descPlaceholder,
    nameTooltip,
    descTooltip,
    ...restProps
  } = props;
  const { control, formState } = useFormContext<APISIXType['Basic']>();
  const { t } = useTranslation();
  const np = useNamePrefix();
  const isReadOnly = formState.disabled;

  const desc = useWatch({ control, name: np('desc') as 'desc' });
  const labels = useWatch({ control, name: np('labels') as 'labels' });
  const hasLabels = labels && typeof labels === 'object' && Object.keys(labels).length > 0;

  return (
    <FormSection
      legend={restProps.legend || t('form.basic.title')}
      {...restProps}
    >
      <Stack gap="md" mt="sm">
        {showGeneral && <FormSectionGeneralContent readOnly={restProps.disabled} />}
        {before}
        {showName && (
          <FormItemTextInput
            name={np('name')}
            label={nameTooltip ? <LabelWithTooltip label={t('form.basic.name')} tooltip={nameTooltip} /> : t('form.basic.name')}
            control={control}
            withAsterisk
            placeholder={namePlaceholder}
          />
        )}
        {showDesc && (!isReadOnly || !!desc) && (
          <FormItemTextarea
            name={np('desc')}
            label={descTooltip ? <LabelWithTooltip label={t('form.basic.desc')} tooltip={descTooltip} /> : t('form.basic.desc')}
            control={control}
            placeholder={descPlaceholder}
          />
        )}
        {showLabels && (!isReadOnly || hasLabels) && <FormItemLabels name={np('labels')} control={control} />}
        {showStatus && <FormItemStatus />}
        {children}
      </Stack>
    </FormSection>
  );
};
