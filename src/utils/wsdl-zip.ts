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

export const WSDL_ZIP_MAX_FILES = 200;
export const WSDL_ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const isWsdlLike = (name: string): boolean =>
  /\.(wsdl|xml|xsd)$/i.test(name);

export const expandWsdlZip = async (
  data: ArrayBuffer | Uint8Array,
): Promise<{ entry: string; docs: Record<string, string> }> => {
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((f) => !f.dir && isWsdlLike(f.name));

  if (entries.length === 0) {
    throw new Error('No WSDL/XML files found in the ZIP archive.');
  }
  if (entries.length > WSDL_ZIP_MAX_FILES) {
    throw new Error(`ZIP contains too many files (>${WSDL_ZIP_MAX_FILES}).`);
  }

  const docs: Record<string, string> = {};
  let total = 0;
  for (const f of entries) {
    const text = await f.async('string');
    total += text.length;
    if (total > WSDL_ZIP_MAX_TOTAL_BYTES) {
      throw new Error('ZIP expands to too much data; aborting to avoid a zip bomb.');
    }
    docs[f.name] = text;
  }

  const entry =
    entries.find((f) => /\.wsdl$/i.test(f.name))?.name ??
    entries.find((f) => /\.xml$/i.test(f.name))?.name ??
    entries[0].name;

  return { entry, docs };
};
