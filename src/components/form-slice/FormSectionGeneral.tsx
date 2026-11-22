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
const IdLine = ({ asName }: { asName?: boolean }) => {
  const { control } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  const label = asName ? t('form.basic.name') : t('form.info.id');
  const id = (useWatch({ control, name: 'id' }) as string | undefined) ?? '';
  return (
    <Group gap="xs" wrap="nowrap" mb="xs">
      <Text size="xs" c="dimmed" fw={500}>
        {label}
      </Text>
      <TextInput
        aria-label={label}
        // Named as the field it stands for, which the pages and specs find
        // it by; not registered, so the form's own value is left alone.
        name="id"
        value={id}
        readOnly
        disabled
        variant="unstyled"
        size="xs"
        className={asName ? 'id-line id-line--name' : 'id-line'}
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
              aria-label={t('form.info.copyId', { label })}
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
  const { formState } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  // The form's own default, which follows a reset - a restored draft, a
  // copy - rather than the value at mount.
  const generated = formState.defaultValues?.id;
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

/**
 * The ID of a record that has no name of its own: what it is called, typed
 * when it is made, and not changed after.
 */
const NameID = () => {
  const { control } = useFormContext<APISIXType['Info']>();
  const { t } = useTranslation();
  return (
    <FormItemTextInput
      control={control}
      name="id"
      label={t('form.basic.name')}
      description={t('form.info.idAsNameHint')}
      withAsterisk
    />
  );
};

export type FormSectionGeneralProps = {
  /**
   * The record has no name but its ID - a global rule, a secret, a
   * credential - so the ID is shown and asked for as its name.
   */
  idAsName?: boolean;
  /** will be default to `readOnly` */
  showDate?: boolean;
  showID?: boolean;
  readOnly?: boolean;
};

export const FormSectionGeneralContent = (props: FormSectionGeneralProps) => {
  const { showDate = props.readOnly, showID = true, readOnly = false, idAsName } = props;
  const { register } = useFormContext<APISIXType['Info']>();
  return (
    <>
      {/* Outside the fieldset: its copy button stays usable read-only. */}
      {showID && readOnly && <IdLine asName={idAsName} />}
      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        {showID && !readOnly && (idAsName ? <NameID /> : <NewID />)}
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
  const { t } = useTranslation();
  return (
    // Not disabled as a whole: its fields have a fieldset of their own, and
    // the ID line's copy button, outside it, has to stay usable read-only.
    <FormSection legend={t('form.general.title')}>
      <FormSectionGeneralContent {...props} />
    </FormSection>
  );
};
