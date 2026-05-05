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
import { z } from 'zod';

import { APISIXServices } from '@/types/schema/apisix/services';

export const ServicePostSchema = APISIXServices.ServicePost.extend({
    name: z.string().min(1, { message: 'Name is required' }),
    hosts: z.array(z.string().min(1, { message: 'Host cannot be empty' })).optional(),
}).superRefine((data, ctx) => {
    if (
        (!data.upstream_id || data.upstream_id === 'custom') &&
        (!data.upstream?.nodes ||
            (Array.isArray(data.upstream.nodes) && data.upstream.nodes.length === 0))
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'At least one node is required',
            path: ['upstream', 'nodes'],
        });
    }
});

export type ServicePostType = z.infer<typeof ServicePostSchema>;
