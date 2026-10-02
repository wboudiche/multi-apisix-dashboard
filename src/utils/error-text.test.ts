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
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RoutePostSchema } from '@/components/form-slice/FormPartRoute/schema';
import i18n from '@/config/i18n';
import { REQUIRED } from '@/config/zod-errors';

import { errorText } from './error-text';

// "Name is required" was a string in a schema, and English in every language
// (#364).
describe('a form error', () => {
  it('is what its key says, in the language of the page', async () => {
    expect(errorText('form.validation.nameRequired')).toBe('Name is required');

    await i18n.changeLanguage('de');
    try {
      expect(errorText('form.validation.nameRequired')).toBe('Name ist erforderlich');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('is shown as it is when it is not a key: zod’s own words, a gateway’s', () => {
    expect(errorText('Expected number, received string')).toBe('Expected number, received string');
    expect(errorText('invalid configuration: property "uri" is required')).toBe(
      'invalid configuration: property "uri" is required'
    );
  });

  it('is shown as it is when it spells a key that is not a form error’s', () => {
    // Top-level names of the bundles: `or` is a key, `error` a whole block.
    expect(errorText('or')).toBe('or');
    expect(errorText('error')).toBe('error');
    expect(errorText('sources.routes')).toBe('sources.routes');
  });

  it('is nothing when there is no error', () => {
    expect(errorText(undefined)).toBeUndefined();
  });

  const messagesFor = (values: unknown) => {
    const parsed = RoutePostSchema.safeParse(values);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  };

  it('is a key for a field of the route form never typed in, not zod’s "Required"', () => {
    const messages = messagesFor({});

    expect(messages).toEqual(
      expect.arrayContaining(['form.validation.nameRequired', 'form.validation.uriRequired'])
    );
    expect(messages).not.toContain('Required');
  });

  it('is a key for a route with nowhere to send its traffic', () => {
    expect(messagesFor({ name: 'a', uri: '/a' })).toEqual(['form.validation.upstreamSourceRequired']);
  });

  it('is a key the bundles hold, for each of those', () => {
    for (const key of [
      'form.validation.nameRequired',
      'form.validation.uriRequired',
      'form.validation.upstreamSourceRequired',
      REQUIRED,
    ]) {
      expect(i18n.exists(key)).toBe(true);
    }
  });
});

// zod's own words for a field left empty, on every field whose schema writes
// none: "Required", and "String must contain at least 1 character(s)".
describe('a field left empty, where the schema says nothing of its own', () => {
  const messageOf = (schema: z.ZodTypeAny, value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? undefined : parsed.error.issues[0].message;
  };

  it('is the one key, never typed in or emptied again', () => {
    expect(messageOf(z.object({ a: z.string() }), {})).toBe(REQUIRED);
    expect(messageOf(z.string(), null)).toBe(REQUIRED);
    expect(messageOf(z.string().min(1), '')).toBe(REQUIRED);
    expect(errorText(REQUIRED)).toBe('Required');
  });

  it('is still zod’s own for what needs its values', () => {
    expect(messageOf(z.number().min(3), 1)).toBe('Number must be greater than or equal to 3');
    expect(messageOf(z.string().min(2), 'a')).toBe('String must contain at least 2 character(s)');
  });

  it('is the schema’s own where it wrote one', () => {
    expect(messageOf(z.string().min(1, 'form.validation.nameRequired'), '')).toBe(
      'form.validation.nameRequired'
    );
  });
});
