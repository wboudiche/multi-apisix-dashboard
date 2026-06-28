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
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { expandWsdlZip } from '@/utils/wsdl-zip';

const buildZip = async (files: Record<string, string>): Promise<Uint8Array> => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
};

describe('expandWsdlZip', () => {
  it('expands wsdl/xml entries and picks a .wsdl entry', async () => {
    const buf = await buildZip({
      'service.wsdl': '<definitions/>',
      'types.xsd': '<schema/>',
      'readme.txt': 'ignore me',
    });
    const out = await expandWsdlZip(buf);
    expect(out.entry).toBe('service.wsdl');
    expect(Object.keys(out.docs).sort()).toEqual(['service.wsdl', 'types.xsd']);
    expect(out.docs['readme.txt']).toBeUndefined();
  });

  it('throws when no wsdl/xml files are present', async () => {
    const buf = await buildZip({ 'readme.txt': 'nothing here' });
    await expect(expandWsdlZip(buf)).rejects.toThrow(/no WSDL/i);
  });
});
