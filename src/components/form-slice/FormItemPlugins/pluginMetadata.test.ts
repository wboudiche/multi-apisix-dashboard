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
import { afterEach, describe, expect, it } from 'vitest';

import i18n from '@/config/i18n';

import { getPluginDescription, summarizePluginConfig } from './pluginMetadata';

// The plugin picker described every plugin in English, whatever the language
// of the page: a hundred sentences in a table the translations never reached.
describe('the plugin catalogue', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('describes a plugin it knows in the language of the page', async () => {
    expect(getPluginDescription('limit-count')).toBe(
      'Rate limits by request count within a fixed time window'
    );
    await i18n.changeLanguage('de');
    expect(getPluginDescription('limit-count')).toBe(
      'Begrenzt die Anzahl der Anfragen in einem festen Zeitfenster'
    );
  });

  it('prefers its own words to the gateway’s schema, which are English', async () => {
    await i18n.changeLanguage('de');
    expect(getPluginDescription('key-auth', 'Key auth plugin')).toBe(
      'Authentifiziert Anfragen über einen API-Schlüssel-Header'
    );
  });

  it('falls back to the gateway’s words for a plugin it does not know, and to nothing', () => {
    expect(getPluginDescription('my-own-plugin', 'Does my own thing')).toBe('Does my own thing');
    expect(getPluginDescription('my-own-plugin')).toBe('');
  });

  it('describes every plugin it knows, in every language', async () => {
    const known = ['key-auth', 'cors', 'ai-rag', 'mcp-bridge', 'ai', 'http-logger'];
    for (const lng of ['en', 'de', 'es', 'tr', 'zh']) {
      await i18n.changeLanguage(lng);
      for (const name of known) {
        const text = getPluginDescription(name);
        expect(text).not.toBe('');
        expect(text).not.toContain('form.plugins.');
      }
    }
  });

  it('summarises a configuration in the language of the page', async () => {
    await i18n.changeLanguage('de');
    expect(summarizePluginConfig('ip-restriction', { whitelist: ['10.0.0.1', '10.0.0.2'] })).toBe(
      'Erlaubt: 2'
    );
    expect(summarizePluginConfig('kafka-logger', { brokers: [{ host: 'a', port: 9092 }] })).toBe(
      'Broker: 1'
    );
    expect(summarizePluginConfig('proxy-rewrite', { uri: '/a', host: 'b', method: 'GET', scheme: 'http' })).toBe(
      'Konfigurierte Felder: 4'
    );
  });
});
