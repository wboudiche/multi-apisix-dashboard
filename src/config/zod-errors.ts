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

/**
 * What zod says of a field left empty, as a key.
 *
 * A schema that writes no message of its own gets zod's: "Required" for a
 * value that is not there, "String must contain at least 1 character(s)" for
 * one emptied again - in English in every language, on every field the APISIX
 * types validate (#364). Both are the same news to the reader, and the field
 * shows the key's words through errorText.
 *
 * Only that. What zod says of a number out of range or a string that does not
 * match is still zod's, in English: each needs its values, which a key alone
 * does not carry.
 *
 * Installed once, by the import in main.tsx. A message a schema writes itself
 * comes before this map.
 */
export const REQUIRED = 'form.validation.required';

z.setErrorMap((issue, ctx) => {
  const missing =
    issue.code === z.ZodIssueCode.invalid_type &&
    (issue.received === 'undefined' || issue.received === 'null');
  const emptied =
    issue.code === z.ZodIssueCode.too_small && issue.type === 'string' && issue.minimum === 1;
  return { message: missing || emptied ? REQUIRED : ctx.defaultError };
});
