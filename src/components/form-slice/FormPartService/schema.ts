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
import { requiredString } from '@/utils/zod';

import { parseToNodes } from '../FormPartUpstream/node-rows';

export const ServicePostSchema = APISIXServices.ServicePost.extend({
    // Keys, not sentences: the field shows what the key says (see errorText).
    name: requiredString('form.validation.nameRequired'),
    hosts: z.array(z.string().min(1, { message: 'form.validation.hostEmpty' })).optional(),
}).superRefine((data, ctx) => {
    if (
        (!data.upstream_id || data.upstream_id === 'custom') &&
        parseToNodes(data.upstream?.nodes).length === 0
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'form.validation.nodeRequired',
            path: ['upstream', 'nodes'],
        });
    }
});

export type ServicePostType = z.infer<typeof ServicePostSchema>;
