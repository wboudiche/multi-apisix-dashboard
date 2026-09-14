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

import { ActionIcon, Badge, Group, Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { labelApi, type LabelTaxonomy } from '@/apis/labels';
import { currentInstanceIdAtom } from '@/stores/instance';
import IconPlus from '~icons/material-symbols/add';
import IconClose from '~icons/material-symbols/close';

import { labelOptions } from './label-options';

export type LabelFilterProps = {
  value: string[];
  onChange: (labels: string[]) => void;
  /**
   * The labels of the resources being filtered, offered beside the catalogue:
   * it is what may be applied from now on, not all that is there (#190).
   */
  inUse?: ReadonlyArray<Record<string, string> | undefined>;
};

const NO_LABELS: LabelTaxonomy[] = [];

export const LabelFilter = ({ value, onChange, inUse }: LabelFilterProps) => {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  // The catalogue is per instance, so it is keyed by the one selected. It was
  // read once, when the filter mounted, and a switch in the header remounts the
  // list only when the new instance's routes have to be fetched: with them
  // cached, the filter went on offering the instance just left (#190).
  //
  // Substituting an empty catalogue for a failed request made the two
  // indistinguishable: a 401, a 500 or an unreachable backend all rendered as
  // "no labels defined", with nothing logged and nothing shown. Not retried,
  // so a failure says so as soon as it happens.
  const instanceId = useAtomValue(currentInstanceIdAtom);
  const catalogue = useQuery({
    queryKey: ['labels', instanceId],
    queryFn: () => labelApi.list(),
    retry: false,
  });
  const taxonomy = catalogue.data ?? NO_LABELS;
  const status = catalogue.isPending ? 'loading' : catalogue.isError ? 'error' : 'ready';

  // A catalogue that failed to load leaves the filter unavailable, as it did:
  // what is in use is offered beside the catalogue, not instead of it.
  const options = useMemo(
    () => (status === 'ready' ? labelOptions(taxonomy, inUse ?? []) : []),
    [status, taxonomy, inUse]
  );

  const keyOptions = useMemo(
    () => options.map((o) => ({ value: o.key, label: o.label })),
    [options]
  );

  const valueOptions = useMemo(() => {
    if (!selectedKey) return [];
    const option = options.find((o) => o.key === selectedKey);
    return (option?.values || []).map((v) => ({ value: v, label: v }));
  }, [selectedKey, options]);

  const canAdd = selectedKey && selectedValue;

  const handleAdd = useCallback(() => {
    if (!selectedKey || !selectedValue) return;
    const tag = `${selectedKey}:${selectedValue}`;
    if (!value.includes(tag)) {
      onChange([...value, tag]);
    }
    setSelectedKey(null);
    setSelectedValue(null);
  }, [selectedKey, selectedValue, value, onChange]);

  const handleRemove = useCallback(
    (tag: string) => {
      onChange(value.filter((v) => v !== tag));
    },
    [value, onChange]
  );

  const handleKeyChange = useCallback((val: string | null) => {
    setSelectedKey(val);
    setSelectedValue(null);
  }, []);

  return (
    <Group gap="sm" wrap="wrap" align="center" style={{ flex: 1 }}>
      <Select
        data={keyOptions}
        placeholder={
          status === 'loading' ? t('labelFilter.loading') : t('labelFilter.selectKey')
        }
        nothingFoundMessage={t('labelFilter.noKeys')}
        // Nothing can be picked from a catalogue that failed to load, and an
        // empty dropdown would read as "there are none".
        disabled={status === 'error'}
        error={status === 'error' ? t('labelFilter.loadFailed') : undefined}
        size="sm"
        value={selectedKey}
        onChange={handleKeyChange}
        clearable
        style={{ flex: 1, minWidth: 180, maxWidth: 300 }}
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        data={valueOptions}
        placeholder={t('labelFilter.selectValue')}
        nothingFoundMessage={t('labelFilter.noValues')}
        size="sm"
        value={selectedValue}
        onChange={setSelectedValue}
        disabled={!selectedKey}
        clearable
        style={{ flex: 1, minWidth: 180, maxWidth: 300 }}
        comboboxProps={{ withinPortal: true }}
      />
      <ActionIcon
        variant="filled"
        color="blue"
        size="input-sm"
        disabled={!canAdd}
        onClick={handleAdd}
        aria-label={t('labelFilter.add')}
      >
        <IconPlus width="14" height="14" />
      </ActionIcon>
      {value.map((tag) => (
        <Badge
          key={tag}
          variant="light"
          size="lg"
          rightSection={
            <ActionIcon
              variant="transparent"
              size="xs"
              onClick={() => handleRemove(tag)}
            >
              <IconClose width="10" height="10" />
            </ActionIcon>
          }
        >
          {tag}
        </Badge>
      ))}
    </Group>
  );
};
