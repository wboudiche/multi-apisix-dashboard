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


const scalarParam = z.union([z.string(), z.number()]);
const repeatableParam = z
  .union([scalarParam, z.array(scalarParam)])
  .optional();

export const pageSearchSchema = z
  .object({
    page: z
      .union([z.string(), z.number()])
      .optional()
      .default(1)
      .transform((val) => (val ? Number(val) : 1)),
    page_size: z
      .union([z.string(), z.number()])
      .optional()
      .default(10)
      .transform((val) => (val ? Number(val) : 10)),
    name: z.string().optional(),
    uri: z.string().optional(),
    status: z.union([z.string(), z.number()]).optional(),
    // Repeatable since #142: the routes bar can name several labels, teams or
    // upstreams at once, and qs serialises those as repeated keys. A lone value
    // still arrives as a bare string — an older bookmark holds exactly that.
    //
    // Numbers are admitted for the same reason `status` above admits them: the
    // router parses `?upstream_id=9002` into a number before this sees it, and
    // an id really can be numeric (APISIX keeps whichever JSON type it was
    // created with). Rejecting one puts the whole page on the error screen.
    // Consumers normalise; nothing downstream may assume a string.
    label: repeatableParam,
    team_id: repeatableParam,
    upstream_id: repeatableParam,
  })
  .passthrough();

export type PageSearchType = z.infer<typeof pageSearchSchema>;
