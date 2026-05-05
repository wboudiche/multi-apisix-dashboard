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
import { ActionIcon, Button, Group, InputWrapper, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useController, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import IconAdd from '~icons/material-symbols/add';
import IconDelete from '~icons/material-symbols/close-rounded';

import { LabelWithTooltip } from '../../form/LabelWithTooltip';
import { FormItemPlugins } from '../FormItemPlugins';
import { FormSection } from '../FormSection';
import type { ServicePostType } from './schema';


export const FormItemHostsList = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<ServicePostType>();
  const { field, fieldState } = useController({
    name: 'hosts',
    control,
    defaultValue: []
  });

  const hosts = Array.isArray(field.value) ? field.value : [];
  const displayHosts = hosts.length > 0 ? hosts : [''];

  const handleChange = (index: number, value: string) => {
    const newHosts = [...displayHosts];
    newHosts[index] = value;
    field.onChange(newHosts);
  };

  const handleAdd = () => {
    field.onChange([...displayHosts, '']);
  };

  const handleRemove = (index: number) => {
    const newHosts = displayHosts.filter((_, i) => i !== index);
    field.onChange(newHosts.length > 0 ? newHosts : []);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (index === displayHosts.length - 1 && displayHosts[index] !== '') {
        handleAdd();
        setTimeout(() => {
          const inputs = document.querySelectorAll<HTMLInputElement>('[data-hosts-input]');
          inputs[inputs.length - 1]?.focus();
        }, 0);
      }
    }
  };

  const rootError = fieldState.error?.message;
  const arrayErrors = Array.isArray(fieldState.error) ? fieldState.error : [];

  return (
    <InputWrapper
      label={<LabelWithTooltip label={t('form.services.hosts')} tooltip={t('form.services.tooltip.hosts')} />}
      description={t('form.services.hostsDescription')}
      error={rootError}
    >
      <Stack gap="xs" mt={6}>
        {displayHosts.map((hostValue, idx) => {
          const itemError = arrayErrors[idx]?.message;
          return (
            <Group key={idx} gap="xs" align="flex-start" wrap="nowrap">
              <TextInput
                data-hosts-input
                style={{ flex: 1 }}
                value={hostValue}
                onChange={(e) => handleChange(idx, e.currentTarget.value)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                placeholder={t('form.services.hostsPlaceholder')}
                error={itemError}
                leftSection={
                  <Text size="xs" c="dimmed" fw={500}>{idx + 1}</Text>
                }
              />
              <Tooltip label={t('form.btn.delete')} position="right" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  mt={1}
                  onClick={() => handleRemove(idx)}
                  disabled={displayHosts.length === 1 && hostValue === ''}
                >
                  <IconDelete width="16" height="16" />
                </ActionIcon>
              </Tooltip>
            </Group>
          );
        })}
        <Button
          variant="light"
          color="gray"
          size="compact-sm"
          leftSection={<IconAdd width="16" height="16" />}
          onClick={handleAdd}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('form.btn.add')}
        </Button>
      </Stack>
    </InputWrapper>
  );
};

export const FormSectionPlugins = () => {
  const { t } = useTranslation();
  return (
    <FormSection legend={t('form.plugins.label')}>
      <FormItemPlugins name="plugins" />
    </FormSection>
  );
};
