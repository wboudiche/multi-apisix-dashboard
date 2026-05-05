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
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles/global.css';

import { createTheme, MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import { queryClient, router } from './config/global';

// APISIX Brand Colors
const apisixRed = '#F8423F';

// Custom theme with APISIX branding
const theme = createTheme({
  primaryColor: 'apisix-red',
  colors: {
    'apisix-red': [
      '#ffe9e9', // 0 - lightest
      '#ffd4d4', // 1
      '#ffb3b3', // 2
      '#ff8585', // 3
      '#ff5c5c', // 4
      '#ff3d3d', // 5
      apisixRed, // 6 - primary
      '#e63636', // 7
      '#cc2e2e', // 8
      '#b32626', // 9 - darkest
    ],
  },
  fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily: '"Outfit", "Sora", sans-serif',
    fontWeight: '700',
  },
  radius: {
    xs: '6px',
    sm: '10px',
    md: '14px',
    lg: '20px',
    xl: '30px',
  },
  shadows: {
    xs: '0 1px 2px rgba(0,0,0,0.04)',
    sm: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
    md: '0 8px 24px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
    lg: '0 20px 50px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.08)',
    xl: '0 30px 60px rgba(0,0,0,0.15), 0 15px 30px rgba(0,0,0,0.1)',
  },
  other: {
    primaryColor: apisixRed,
  },
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Card: {
      defaultProps: {
        radius: 'lg',
        shadow: 'sm',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'lg',
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'md',
        size: 'md',
      },
    },
    Select: {
      defaultProps: {
        radius: 'md',
        size: 'md',
      },
    },
    Textarea: {
      defaultProps: {
        radius: 'md',
        size: 'md',
      },
    },
    NumberInput: {
      defaultProps: {
        radius: 'md',
        size: 'md',
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: 'md',
        size: 'md',
      },
    },
    TagsInput: {
      defaultProps: {
        radius: 'md',
        size: 'md',
      },
    },
    InputWrapper: {
      defaultProps: {
        size: 'md',
      },
    },
    Modal: {
      defaultProps: {
        radius: 'xl',
        centered: true,
      },
    },
    NavLink: {
      defaultProps: {
        radius: 'md',
      },
    },
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
      },
    },
    Badge: {
      defaultProps: {
        radius: 'xl',
      },
    },
    Tabs: {},
    Tooltip: {
      defaultProps: {
        radius: 'md',
      },
    },
  },
});

// Render the app
const rootElement = document.getElementById('root')!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <MantineProvider theme={theme}>
        <Notifications position="top-right" autoClose={5000} limit={5} />
        <QueryClientProvider client={queryClient}>
          <ModalsProvider>
            <RouterProvider router={router} />
          </ModalsProvider>
        </QueryClientProvider>
      </MantineProvider>
    </StrictMode>
  );
}
