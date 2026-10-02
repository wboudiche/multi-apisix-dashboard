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

import { withValues } from '@/utils/error-text';

/**
 * What zod says of a value it refuses, as a key and the values its text needs.
 *
 * A schema that writes no message of its own gets zod's: "Required", "String
 * must contain at least 2 character(s)", "Number must be less than or equal to
 * 65535", "Invalid input: must start with \"/\"" - in English in every
 * language, on every field the APISIX types validate (#364). Each is a key
 * here, the field shows the key's words through errorText, and a minimum, a
 * maximum or a prefix goes with it.
 *
 * A field left empty is one message, whether it was never typed in or emptied
 * again: both are the same news to the reader. Whatever zod says that has no
 * key of its own here - a union none of whose members fits, a refinement that
 * wrote nothing - is that the value is not valid, rather than zod's words.
 *
 * Installed once, by the import in main.tsx. A message a schema writes itself
 * comes before this map.
 */
export const REQUIRED = 'form.validation.required';

const INVALID = 'form.validation.invalidValue';

/** zod's numbers: a bigint has no place in JSON, and none of ours is past 2^53. */
const n = (value: number | bigint) => Number(value);

const keyOf = (issue: z.ZodIssueOptionalMessage): string => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return REQUIRED;
      if (issue.expected === 'integer') return 'form.validation.notInteger';
      if (issue.expected === 'number') return 'form.validation.notANumber';
      if (issue.expected === 'string') return 'form.validation.notText';
      return INVALID;
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        if (issue.exact) return withValues('form.validation.lengthExactly', { count: n(issue.minimum) });
        if (n(issue.minimum) === 1) return REQUIRED;
        return withValues('form.validation.tooShort', { count: n(issue.minimum) });
      }
      if (issue.type === 'number' || issue.type === 'bigint') {
        return withValues(
          issue.inclusive ? 'form.validation.atLeast' : 'form.validation.greaterThan',
          { minimum: n(issue.minimum) }
        );
      }
      if (issue.type === 'array' || issue.type === 'set') {
        if (issue.exact) return withValues('form.validation.itemsExactly', { count: n(issue.minimum) });
        return withValues('form.validation.tooFewItems', { count: n(issue.minimum) });
      }
      return INVALID;
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        if (issue.exact) return withValues('form.validation.lengthExactly', { count: n(issue.maximum) });
        return withValues('form.validation.tooLong', { count: n(issue.maximum) });
      }
      if (issue.type === 'number' || issue.type === 'bigint') {
        return withValues(
          issue.inclusive ? 'form.validation.atMost' : 'form.validation.lessThan',
          { maximum: n(issue.maximum) }
        );
      }
      if (issue.type === 'array' || issue.type === 'set') {
        if (issue.exact) return withValues('form.validation.itemsExactly', { count: n(issue.maximum) });
        return withValues('form.validation.tooManyItems', { count: n(issue.maximum) });
      }
      return INVALID;
    case z.ZodIssueCode.invalid_string: {
      const v = issue.validation;
      if (typeof v === 'object' && 'startsWith' in v) {
        return withValues('form.validation.startsWith', { prefix: v.startsWith });
      }
      if (typeof v === 'object' && 'endsWith' in v) {
        return withValues('form.validation.endsWith', { suffix: v.endsWith });
      }
      if (typeof v === 'object' && 'includes' in v) {
        return withValues('form.validation.includes', { text: v.includes });
      }
      if (v === 'url') return 'form.validation.notAUrl';
      if (v === 'email') return 'form.validation.notAnEmail';
      return 'form.validation.invalidFormat';
    }
    case z.ZodIssueCode.invalid_literal:
      return withValues('form.validation.mustBe', { expected: String(issue.expected) });
    case z.ZodIssueCode.invalid_enum_value:
      return withValues('form.validation.oneOf', { options: issue.options.join(', ') });
    case z.ZodIssueCode.not_multiple_of:
      return withValues('form.validation.multipleOf', { multipleOf: n(issue.multipleOf) });
    case z.ZodIssueCode.not_finite:
      return 'form.validation.notANumber';
    default:
      return INVALID;
  }
};

z.setErrorMap((issue) => ({ message: keyOf(issue) }));
