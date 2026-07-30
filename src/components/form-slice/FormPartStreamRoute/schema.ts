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
import { type TypeOf, z } from 'zod';

import { APISIXCommon } from '@/types/schema/apisix/common';
import { APISIXStreamRoutes } from '@/types/schema/apisix/stream_routes';

import { SERVICE_NONE, UPSTREAM_CUSTOM } from '../FormPartRoute/util';

export const StreamRoutePostSchema = APISIXStreamRoutes.StreamRoute.omit({
  create_time: true,
  update_time: true,
  id: true,
})
  .merge(APISIXCommon.Basic)
  // Same rule the HTTP route form already applies (see FormPartRoute/schema).
  // Every field of a stream route is optional, and APISIX accepts an entirely
  // empty body with a 201, so without this an empty form saves a row of dashes
  // that can never forward anything.
  .superRefine((data, ctx) => {
    const hasService = data.service_id && data.service_id !== SERVICE_NONE;
    const hasExistingUpstream =
      data.upstream_id && data.upstream_id !== UPSTREAM_CUSTOM;
    const nodes = data.upstream?.nodes;
    const hasCustomUpstream =
      data.upstream_id === UPSTREAM_CUSTOM &&
      !!nodes &&
      (Array.isArray(nodes) ? nodes.length > 0 : Object.keys(nodes).length > 0);

    if (!hasService && !hasExistingUpstream && !hasCustomUpstream) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Select an upstream, bind a service, or configure a custom upstream with at least one node',
        path: ['upstream_id'],
      });
    }
  });

export type StreamRoutePostType = TypeOf<typeof StreamRoutePostSchema>;
