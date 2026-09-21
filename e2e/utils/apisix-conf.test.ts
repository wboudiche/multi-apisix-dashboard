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
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { withProxyMode } from './apisix-conf';

const CONF_PATH = path.join(import.meta.dirname, '../server/apisix_conf.yml');

describe('withProxyMode', () => {
  it('changes the mode', () => {
    const conf = [
      'apisix:',
      '  node_listen: 9080',
      '  proxy_mode: http&stream',
      '  stream_proxy:',
      '    tcp:',
      '      - 9100',
    ].join('\n');

    expect(withProxyMode(conf, 'http')).toContain('proxy_mode: http\n');
    expect(withProxyMode(conf, 'http')).toContain('- 9100');
  });

  // The point of the exercise: a comment is the part of a config file that
  // cannot be reconstructed from the rest of it.
  it('keeps the comments around the value it changes', () => {
    const conf = [
      'apisix:',
      '  node_listen: 9080',
      '  # the transport modes this gateway serves',
      '  proxy_mode: http&stream',
      '  # everything below is about the control API',
      '  control:',
      '    ip: 0.0.0.0',
    ].join('\n');

    const updated = withProxyMode(conf, 'http');

    expect(updated).toContain('# the transport modes this gateway serves');
    expect(updated).toContain('# everything below is about the control API');
    expect(updated).toContain('proxy_mode: http\n');
  });

  // Against the real file, so that a comment added to it later is covered
  // without anyone remembering to update this test.
  it('leaves the gateway config byte for byte as it found it', async () => {
    const conf = await readFile(CONF_PATH, 'utf-8');
    const comments = (conf.match(/^\s*#/gm) ?? []).length;
    expect(comments).toBeGreaterThan(0);

    // Back to whatever mode the file is in rather than to a fixed one: an e2e
    // run interrupted between its two hooks leaves the file on `http`, and a
    // hardcoded `http&stream` would then fail this with a whole-file diff that
    // says nothing about the real problem.
    const mode = conf.match(/^\s*proxy_mode:\s*(\S+)/m)?.[1];
    expect(mode).toBeTruthy();

    const roundTripped = withProxyMode(withProxyMode(conf, 'other'), mode as string);

    expect((roundTripped.match(/^\s*#/gm) ?? []).length).toBe(comments);
    expect(roundTripped).toBe(conf);
  });

  // The compose files hand the second gateway its etcd prefix through an
  // env var that APISIX expands from config.yaml. The placeholder is plain
  // text to the yaml library; this pins that it is neither quoted nor folded
  // on the way through.
  it('keeps APISIX env placeholders byte for byte', () => {
    const conf = [
      'apisix:',
      '  proxy_mode: http&stream',
      '  control:',
      '    ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}',
      'deployment:',
      '  etcd:',
      '    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}',
    ].join('\n');

    const updated = withProxyMode(conf, 'http');

    expect(updated).toContain('    ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}\n');
    expect(updated).toContain('    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}\n');
  });

  // Serialising a broken document throws on its own, so nothing unreadable is
  // written back either way. What this asks for is the message: the parse
  // error names the line, "cannot be stringified" does not.
  it('reports where a broken config is broken', () => {
    expect(() => withProxyMode('apisix:\n  proxy_mode: http\n---\nsecond: doc\n', 'http'))
      .toThrowError(/document/i);
  });
});
