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
import { type Control, useWatch } from 'react-hook-form';

import { getRouteListQueryOptions } from '@/apis/hooks';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { type ComparableRoute, findRouteDuplicates } from '@/utils/route-duplicates';

/**
 * Reports existing routes that clash with the one being filled in, by name or by
 * path. Advisory only: APISIX serves many routes on one path and chooses by
 * priority and `vars`, so a clash is usually unintended but never invalid.
 *
 * `excludeID` lets an edit ignore the route being edited.
 *
 * Pass `control` when calling this from the component that *renders* the
 * FormProvider rather than from inside it — there is no form context to read
 * from at that point, and useWatch would throw on a null control.
 */
export const useDuplicateRouteCheck = (opts?: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control?: Control<any>;
  excludeID?: string;
}) => {
  const { control, excludeID } = opts ?? {};
  const name = useWatch({ control, name: 'name' }) || '';
  const uri = useWatch({ control, name: 'uri' }) || '';
  const uris = useWatch({ control, name: 'uris' });
  const watchedMethods = useWatch({ control, name: 'methods' });
  const [debouncedName] = useDebouncedValue(name, 500);
  const [debouncedUri] = useDebouncedValue(uri, 500);

  const hasSomethingToCompare = !!debouncedUri || !!debouncedName || !!uris?.length;

  const { data: routes } = useQuery({
    // The whole list, not the first page: a duplicate hiding on page two is the
    // one most likely to be missed by a human, so it must not be missed here.
    ...getRouteListQueryOptions({ page: 1, page_size: PAGE_SIZE_MAX }),
    enabled: hasSomethingToCompare,
  });

  const duplicates = useMemo(() => {
    if (!routes?.list || !hasSomethingToCompare) return [];
    const existing: ComparableRoute[] = routes.list.map((route) => route.value);
    return findRouteDuplicates(
      existing,
      {
        name: debouncedName,
        uri: debouncedUri,
        uris: uris ?? undefined,
        methods: watchedMethods ?? undefined,
      },
      excludeID
    );
  }, [routes, debouncedName, debouncedUri, uris, watchedMethods, excludeID, hasSomethingToCompare]);

  return { isDuplicate: duplicates.length > 0, duplicates };
};
