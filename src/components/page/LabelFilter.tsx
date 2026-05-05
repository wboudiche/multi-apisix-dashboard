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
import { useCallback, useEffect, useMemo, useState } from 'react';

import { labelApi, type LabelTaxonomy } from '@/apis/labels';
import IconPlus from '~icons/material-symbols/add';
import IconClose from '~icons/material-symbols/close';

export type LabelFilterProps = {
  value: string[];
  onChange: (labels: string[]) => void;
};

export const LabelFilter = ({ value, onChange }: LabelFilterProps) => {
  const [taxonomy, setTaxonomy] = useState<LabelTaxonomy[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  useEffect(() => {
    labelApi.list().then(setTaxonomy).catch(() => setTaxonomy([]));
  }, []);

  const keyOptions = useMemo(
    () => taxonomy.map((l) => ({ value: l.key, label: l.display_name || l.key })),
    [taxonomy]
  );

  const valueOptions = useMemo(() => {
    if (!selectedKey) return [];
    const label = taxonomy.find((l) => l.key === selectedKey);
    return (label?.values || []).map((v) => ({ value: v, label: v }));
  }, [selectedKey, taxonomy]);

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
        placeholder="Select key"
        size="sm"
        value={selectedKey}
        onChange={handleKeyChange}
        clearable
        style={{ flex: 1, minWidth: 180, maxWidth: 300 }}
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        data={valueOptions}
        placeholder="Select value"
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
