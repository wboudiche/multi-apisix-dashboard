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
import { Group, Text, Tooltip } from '@mantine/core';

import IconInfo from '~icons/material-symbols/info-outline';

type LabelWithTooltipProps = {
  label: string;
  tooltip: string;
};

export const LabelWithTooltip = ({ label, tooltip }: LabelWithTooltipProps) => (
  <Group gap={4} align="center">
    <Text size="sm" fw={500}>{label}</Text>
    <Tooltip label={tooltip} multiline w={280} withArrow position="top-start">
      <span style={{ display: 'inline-flex', cursor: 'help' }}>
        <IconInfo width="14" height="14" style={{ color: 'var(--text-muted)', opacity: 0.7 }} />
      </span>
    </Tooltip>
  </Group>
);
