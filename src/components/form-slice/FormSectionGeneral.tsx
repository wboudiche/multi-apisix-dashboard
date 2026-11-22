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
import { ActionIcon, CopyButton, Group, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { APISIXType } from '@/types/schema/apisix';
import IconCheck from '~icons/material-symbols/check';
import IconCopy from '~icons/material-symbols/content-copy-outline';

import { FormItemTextInput } from '../form/TextInput';
import { AdvancedSection } from './AdvancedSection';
import { FormDisplayDate } from './FormDisplayDate';
import { FormSection } from './FormSection';

const DisplayDate = () => {
  const { control } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  const createTime = useWatch({ control, name: 'create_time' });
  const updateTime = useWatch({ control, name: 'update_time' });
  return (
    <>
      <FormDisplayDate date={createTime} label={t('form.info.create_time')} />
      <FormDisplayDate date={updateTime} label={t('form.info.update_time')} />
    </>
  );
};

const FormItemID = () => {
  const { control } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  return (
    <FormItemTextInput control={control} name="id" label={t('form.info.id')} />
  );
};

/**
 * A record's ID, shown rather than offered: the key APISIX and its API know
 * it by - worth copying into a script or a log search - but not what anyone
 * reads it by, its name. One quiet line, with a way to copy it.
 */
const IdLine = () => {
  const { control } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  const id = (useWatch({ control, name: 'id' }) as string | undefined) ?? '';
  return (
    <Group gap="xs" wrap="nowrap" mb="xs">
      <Text size="xs" c="dimmed" fw={500}>
        {t('form.info.id')}
      </Text>
      <TextInput
        aria-label={t('form.info.id')}
        // Named as the field it stands for, which the pages and specs find
        // it by; not registered, so the form's own value is left alone.
        name="id"
        value={id}
        readOnly
        variant="unstyled"
        size="xs"
        className="id-line"
        style={{ flex: 1 }}
      />
      <CopyButton value={id}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? t('form.json.copied') : t('form.json.copy')}>
            <ActionIcon
              variant="subtle"
              color={copied ? 'teal' : 'gray'}
              size="sm"
              onClick={copy}
              aria-label={t('form.json.copy')}
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
};

/**
 * A new record's ID, generated for it and folded away: few set one by hand.
 * Opened by itself when the ID is no longer the one generated.
 */
const NewID = () => {
  const { getValues } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  const [generated] = useState(() => getValues('id'));
  return (
    <AdvancedSection
      label={t('form.info.idAdvanced')}
      names={['id']}
      isDefault={(_, value) => value === generated || !value}
    >
      <FormItemID />
    </AdvancedSection>
  );
};

export type FormSectionGeneralProps = {
  /** will be default to `readOnly` */
  showDate?: boolean;
  showID?: boolean;
  readOnly?: boolean;
};

export const FormSectionGeneralContent = (props: FormSectionGeneralProps) => {
  const { showDate = props.readOnly, showID = true, readOnly = false } = props;
  const { register } = useFormContext<APISIXType['Info']>();
  return (
    <>
      {/* Outside the fieldset: its copy button stays usable read-only. */}
      {showID && readOnly && <IdLine />}
      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        {showID && !readOnly && <NewID />}
        {/* Field names, which the rule reads as text because they sit in
            JSX: nothing here is shown. */}
        {/* eslint-disable-next-line i18next/no-literal-string */}
        <input type="hidden" {...register('create_time')} />
        {/* eslint-disable-next-line i18next/no-literal-string */}
        <input type="hidden" {...register('update_time')} />
        {showDate && <DisplayDate />}
      </fieldset>
    </>
  );
};

export const FormSectionGeneral = (props: FormSectionGeneralProps) => {
  const { readOnly = false } = props;
  const { t } = useTranslation();
  return (
    <FormSection legend={t('form.general.title')} disabled={readOnly}>
      <FormSectionGeneralContent {...props} />
    </FormSection>
  );
};
