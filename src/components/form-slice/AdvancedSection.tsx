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
import { Box, Button, Collapse, Stack } from '@mantine/core';
import { type PropsWithChildren, type ReactNode, useState } from 'react';
import { get, useFormContext, useFormState, useWatch } from 'react-hook-form';

import IconExpandMore from '~icons/material-symbols/keyboard-arrow-down';
import IconExpandLess from '~icons/material-symbols/keyboard-arrow-up';

const hasValue = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '' || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as object).some(hasValue);
  return true;
};

type Props = PropsWithChildren<{
  /** What the toggle says: "Advanced matching", "Advanced settings". */
  label: ReactNode;
  /** The fields inside, by their form names: whether to open by itself. */
  names: string[];
  /**
   * What these fields hold when nobody set them - the defaults a new form
   * starts with - so that a default alone does not open the section.
   */
  isDefault?: (name: string, value: unknown) => boolean;
}>;

/**
 * Fields most routes never set, folded away behind one toggle.
 *
 * Folded is only the starting state, and only while there is nothing to see
 * in it: the section opens by itself when one of its fields holds a value of
 * its own - a route being edited, a draft restored, an answer handed over by
 * the quick-create dialog - and when one of them is refused, so an error is
 * never behind a closed toggle. Read-only, it shows when it has something to
 * show and is left out otherwise.
 */
export const AdvancedSection = ({ label, names, isDefault, children }: Props) => {
  const { control, formState } = useFormContext();
  const values = useWatch({ control, name: names }) as unknown[];
  const { errors } = useFormState({ control, name: names });

  const set = names.some((name, i) => hasValue(values[i]) && !isDefault?.(name, values[i]));
  const refused = names.some((name) => get(errors, name) !== undefined);
  // Opened by what it holds, it stays open: emptying a field to retype it,
  // or putting right what was refused, must not fold it under the cursor.
  const holds = set || refused;
  const [opened, setOpened] = useState(holds);
  // Adjusted while rendering, as React would have it rather than in an
  // effect: the render that sees it start holding something opens it.
  const [held, setHeld] = useState(holds);
  if (holds !== held) {
    setHeld(holds);
    if (holds) setOpened(true);
  }
  const shown = opened || refused;

  if (formState.disabled) return set ? <Stack gap="md">{children}</Stack> : null;

  return (
    <Box>
      <Button
        variant="subtle"
        size="compact-sm"
        px={0}
        onClick={() => setOpened((o) => !o)}
        // Not while something in it is refused: the error would be folded away.
        disabled={refused}
        rightSection={shown ? <IconExpandLess width="18" height="18" /> : <IconExpandMore width="18" height="18" />}
        aria-expanded={shown}
      >
        {label}
      </Button>
      <Collapse in={shown}>
        <Stack gap="md" pt="sm">
          {children}
        </Stack>
      </Collapse>
    </Box>
  );
};
