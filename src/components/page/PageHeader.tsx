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
import { Box, Group, Stack, Text, Title } from '@mantine/core';
import { type FC } from 'react';



type PageHeaderProps = {
  title: string;
  desc?: string;
  extra?: React.ReactNode;
};

const PageHeader: FC<PageHeaderProps> = (props) => {
  const { title, desc, extra } = props;
  return (
    <Box className="PageTitle-root" mb="md">
      <Group justify="space-between" align="center">
        <Stack gap={4}>
          <Title order={1} style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '1.75rem',
            letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--brand) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            {title}
          </Title>
          {desc && (
            <Text
              size="sm"
              style={{
                color: 'var(--text-muted)',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {desc}
            </Text>
          )}
        </Stack>
        {extra}
      </Group>
    </Box>
  );
};

export default PageHeader;
