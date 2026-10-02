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

import { errorText, withValues } from './error-text';

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

  it('is shown as it is when it is not a key: a gateway’s words', () => {
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

  it('is the schema’s own where it wrote one, before the map', () => {
    expect(messageOf(z.number().min(3, 'form.validation.nameRequired'), 1)).toBe(
      'form.validation.nameRequired'
    );
  });

  it('is the schema’s own where it wrote one', () => {
    expect(messageOf(z.string().min(1, 'form.validation.nameRequired'), '')).toBe(
      'form.validation.nameRequired'
    );
  });
});

// zod's words for what needs its values - "String must contain at least 2
// character(s)", "Number must be less than or equal to 65535" - were English
// in every language: a key alone could not carry the 2 or the 65535.
describe('what zod refuses, where the schema says nothing of its own', () => {
  const shown = (schema: z.ZodTypeAny, value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) throw new Error('accepted');
    return errorText(parsed.error.issues[0].message);
  };

  const cases: [string, z.ZodTypeAny, unknown, string, string][] = [
    ['a string too short', z.string().min(3), 'ab', 'Must be at least 3 characters long', 'Muss mindestens 3 Zeichen lang sein'],
    ['a string too long', z.string().max(1), 'ab', 'Must be at most 1 character long', 'Darf höchstens 1 Zeichen lang sein'],
    ['a string not its length', z.string().length(4), 'ab', 'Must be exactly 4 characters long', 'Muss genau 4 Zeichen lang sein'],
    ['a number too small', z.number().gte(1), 0, 'Must be at least 1', 'Muss mindestens 1 sein'],
    ['a number not above', z.number().gt(0), 0, 'Must be greater than 0', 'Muss größer als 0 sein'],
    ['a number too big', z.number().lte(65535), 70000, 'Must be at most 65535', 'Darf höchstens 65535 sein'],
    ['a number not below', z.number().lt(10), 10, 'Must be less than 10', 'Muss kleiner als 10 sein'],
    ['a fraction', z.number().int(), 1.5, 'Must be a whole number', 'Muss eine ganze Zahl sein'],
    ['text for a number', z.number(), 'x', 'Must be a number', 'Muss eine Zahl sein'],
    ['a number for text', z.string(), 1, 'Must be text', 'Muss Text sein'],
    ['a missing prefix', z.string().startsWith('/'), 'a', 'Must start with /', 'Muss mit / beginnen'],
    ['a missing suffix', z.string().endsWith('.proto'), 'a', 'Must end with .proto', 'Muss mit .proto enden'],
    ['a pattern not matched', z.string().regex(/^\d+$/), 'a', 'The format is not valid', 'Das Format ist ungültig'],
    ['too few items', z.array(z.string()).min(2), ['a'], 'Must have at least 2 items', 'Muss mindestens 2 Einträge haben'],
    ['too many items', z.array(z.string()).max(1), ['a', 'b'], 'Must have at most 1 item', 'Darf höchstens 1 Eintrag haben'],
    ['another literal', z.literal('roundrobin'), 'chash', 'Must be roundrobin', 'Muss roundrobin sein'],
    ['a value not listed', z.enum(['http', 'https']), 'ftp', 'Must be one of: http, https', 'Muss einer der folgenden Werte sein: http, https'],
    ['no member of a union', z.union([z.literal('a'), z.literal('b')]), 'c', 'This value is not valid', 'Dieser Wert ist ungültig'],
    ['a refinement with no words', z.string().refine(() => false), 'a', 'This value is not valid', 'Dieser Wert ist ungültig'],
  ];

  it.each(cases)('is said in the language of the page: %s', async (_, schema, value, en, de) => {
    expect(shown(schema, value)).toBe(en);
    await i18n.changeLanguage('de');
    try {
      expect(shown(schema, value)).toBe(de);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('leaves no placeholder unfilled, in any language', async () => {
    for (const lng of ['en', 'de', 'es', 'tr', 'zh']) {
      await i18n.changeLanguage(lng);
      try {
        for (const [, schema, value] of cases) {
          const text = shown(schema, value);
          expect(text).not.toMatch(/\{\{|form\.validation\./);
        }
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  });

  it('carries a value with any character in it', () => {
    expect(shown(z.string().startsWith('a?b "c" /d'), 'x')).toBe('Must start with a?b "c" /d');
  });
});

describe('a key with values', () => {
  it('is shown as it is when what follows the key is not values', () => {
    expect(errorText('form.validation.atLeast?not json')).toBe('form.validation.atLeast?not json');
    expect(errorText('form.validation.atLeast?[1]')).toBe('form.validation.atLeast?[1]');
  });

  it('is shown as it is when the key is no form error’s', () => {
    const message = withValues('form.validation.noSuchKey', { minimum: 1 });
    expect(errorText(message)).toBe(message);
  });
});
