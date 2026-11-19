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
import { useTranslation } from 'react-i18next';

/**
 * Names for a Mantine Pagination's arrows, for its `getControlProps`. Its
 * previous and next buttons are an icon each, and read to a screen reader as
 * a button with no name (axe's button-name).
 */
export const usePaginationControlProps = () => {
  const { t } = useTranslation();
  return (control: 'first' | 'previous' | 'last' | 'next') => ({
    'aria-label':
      control === 'first'
        ? t('table.firstPage')
        : control === 'previous'
          ? t('table.previousPage')
          : control === 'next'
            ? t('table.nextPage')
            : t('table.lastPage'),
  });
};
