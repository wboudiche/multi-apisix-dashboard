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
import {
  Group,
  Paper,
  type PaperProps,
  Stack,
  TableOfContents,
  type TableOfContentsProps,
  Text,
} from '@mantine/core';
import { useShallowEffect } from '@mantine/hooks';
import { clsx } from 'clsx';
import { debounce } from 'rambdax';
import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';

import { APPSHELL_HEADER_HEIGHT } from '@/config/constant';

import classes from './style.module.css';

const SectionDepthCtx = createContext<number>(0);

const SectionDepthProvider = SectionDepthCtx.Provider;

// `form-section` class is for TableOfContents
const tocSelector = 'form-section';
const tocValue = 'data-label';
const tocDepth = 'data-depth';

const FormTOCCtx = createContext<{
  refreshTOC: () => void;
  maxDepth?: number;
}>({
  refreshTOC: () => { },
});

export type FormSectionProps = Omit<PaperProps, 'form'> & {
  legend?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  hideInTOC?: boolean;
};

const LegendGroup = ({
  legend,
  extra,
}: {
  legend: ReactNode;
  extra?: ReactNode;
}) => {
  if (!legend && !extra) {
    return null;
  }
  return (
    <Group justify="space-between" mb="xs">
      <Text fw={700} size="lg" style={{ fontFamily: 'Outfit, sans-serif' }}>
        {legend}
      </Text>
      {extra}
    </Group>
  );
};

export const FormSection = (props: FormSectionProps) => {
  const { className, legend, extra, children, hideInTOC, ...restProps } = props;
  const parentDepth = useContext(SectionDepthCtx);
  const { refreshTOC, maxDepth } = useContext(FormTOCCtx);
  const depth = useMemo(() => parentDepth + 1, [parentDepth]);

  const shouldHideInTOC = useMemo(() => {
    if (hideInTOC) return true;
    if (maxDepth !== undefined && depth > maxDepth) return true;
    return false;
  }, [hideInTOC, maxDepth, depth]);

  const dataAttrs = useMemo(
    () => ({
      [tocValue]: legend,
      [tocDepth]: depth,
    }),
    [legend, depth]
  );

  // refresh TOC when children changes
  useShallowEffect(refreshTOC, [children]);

  return (
    <SectionDepthProvider value={depth}>
      <Paper
        className={clsx(!shouldHideInTOC && tocSelector, classes.root, className)}
        p="sm"
        mb="4px"
        withBorder
        radius="lg"
        shadow="xs"
        style={{
          background: 'var(--bg-card)',
        }}
        // Expose the section as a named group (the visual legend is a styled
        // Text, not a <legend>, so screen readers and role-based queries
        // would otherwise see an anonymous container)
        role={legend ? 'group' : undefined}
        aria-label={typeof legend === 'string' ? legend : undefined}
        {...restProps}
        {...(!shouldHideInTOC && dataAttrs)}
      >
        <LegendGroup legend={legend} extra={extra} />
        <Stack gap="md" mt={legend ? 'sm' : 0}>
          {children}
        </Stack>
      </Paper>
    </SectionDepthProvider>
  );
};

const TOC = (props: Pick<TableOfContentsProps, 'reinitializeRef'>) => {
  return (
    <TableOfContents
      variant="light"
      color="apisix-red"
      size="sm"
      radius="md"
      style={{
        flexShrink: 0,
        position: 'sticky',
        top: APPSHELL_HEADER_HEIGHT + 20,
        background: 'transparent',
      }}
      w={220}
      mt={10}
      minDepthToOffset={0}
      depthOffset={20}
      scrollSpyOptions={{
        selector: `.${tocSelector}`,
        getDepth: (el) => Number(el.getAttribute(tocDepth)),
        getValue: (el) => el.getAttribute(tocValue) || '',
      }}
      getControlProps={({ data }) => ({
        onClick: () => {
          return data.getNode().scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'end',
          });
        },
        children: data.value,
        style: {
          borderRadius: '8px',
          fontWeight: 500,
        }
      })}
      {...props}
    />
  );
};

export type FormTOCBoxProps = PropsWithChildren & {
  maxDepth?: number;
};

export const FormTOCBox = (props: FormTOCBoxProps) => {
  const { children, maxDepth } = props;
  const reinitializeRef = useRef(() => { });
  const refreshTOC = useCallback(
    () => debounce(reinitializeRef.current, 200),
    []
  );

  return (
    <Group
      preventGrowOverflow={false}
      wrap="nowrap"
      align="start"
      gap={60}
      style={{ position: 'relative' }}
    >
      <TOC reinitializeRef={reinitializeRef} />
      <div style={{ flex: 1, minWidth: 0, paddingInline: '60px', paddingBottom: '100px', maxWidth: '1400px' }}>
        <FormTOCCtx.Provider value={{ refreshTOC, maxDepth }}>
          {children}
        </FormTOCCtx.Provider>
      </div>
    </Group>
  );
};
