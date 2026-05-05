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
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { getRouteListQueryOptions } from '@/apis/hooks';

export const useDuplicateRouteCheck = () => {
  const { formState } = useFormContext();
  const uri = useWatch({ name: 'uri' }) || '';
  const watchedMethods = useWatch({ name: 'methods' });
  const [debouncedUri] = useDebouncedValue(uri, 500);

  const { data: routes } = useQuery({
    ...getRouteListQueryOptions({ page: 1, page_size: 100 }),
    enabled: !!debouncedUri && !!formState.dirtyFields.uri,
  });

  const duplicates = useMemo(() => {
    const methods: string[] = watchedMethods || [];
    if (!routes?.list || !debouncedUri) return [];
    return routes.list.filter((route) => {
      const r = route.value;
      const uriMatch = r.uri === debouncedUri || r.uris?.includes(debouncedUri);
      if (!uriMatch) return false;
      if (methods.length === 0 || !r.methods || r.methods.length === 0) return uriMatch;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return methods.some((m) => r.methods?.includes(m as any));
    });
  }, [routes, debouncedUri, watchedMethods]);

  return {
    isDuplicate: duplicates.length > 0,
    duplicates: duplicates.map((d) => ({
      id: d.value.id,
      name: d.value.name || d.value.id,
      uri: d.value.uri,
      methods: d.value.methods,
    })),
  };
};
