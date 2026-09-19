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
import { parseDocument } from 'yaml';

/**
 * The gateway's config with its proxy mode changed, and everything else left
 * as it was.
 *
 * `e2e/server/apisix_conf.yml` is a tracked file that one spec edits to take
 * stream mode away and put it back. Parsing it to a plain object and
 * re-serialising dropped every comment in it - including the paragraph saying
 * why an unauthenticated port is exposed - and a local run then left that loss
 * staged for whoever typed `git add -A` next (#290).
 *
 * A document keeps what surrounds the value: comments, key order, quoting
 * style. Only the one line asked for changes.
 */
export const withProxyMode = (conf: string, mode: string): string => {
  const doc = parseDocument(conf);
  // parseDocument collects rather than throws. Serialising a document with
  // errors throws too - "Document with errors cannot be stringified", so
  // nothing unreadable is ever written back - but that message says nothing
  // about the file. This one names the line.
  if (doc.errors.length > 0) throw doc.errors[0];

  doc.setIn(['apisix', 'proxy_mode'], mode);
  // lineWidth: 0 to fold nothing. The default wraps at 80, which would rewrite
  // lines nobody asked to touch the day a long value is added.
  return doc.toString({ lineWidth: 0 });
};
