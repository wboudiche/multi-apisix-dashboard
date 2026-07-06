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

/**
 * Read the SOAPAction a per-operation SOAP route matches on.
 *
 * WSDL-imported per-operation routes discriminate solely on the SOAPAction
 * header via an APISIX `vars` entry of the form
 * `['http_soapaction', '==', '"urn:GetInvoice"']`. The compared value keeps the
 * surrounding double quotes because that is exactly what a SOAP 1.1 client
 * sends, so the returned string is passed through verbatim (quotes included)
 * and can be dropped straight into a `SOAPAction` request header.
 *
 * Returns undefined for routes that carry no such var (passthrough SOAP routes
 * and every non-SOAP route), so callers can treat SOAP seeding as opt-in.
 */
export const extractSoapAction = (vars: unknown): string | undefined => {
  if (!Array.isArray(vars)) return undefined;
  for (const entry of vars) {
    if (
      Array.isArray(entry) &&
      entry[0] === 'http_soapaction' &&
      entry[1] === '==' &&
      typeof entry[2] === 'string'
    ) {
      return entry[2];
    }
  }
  return undefined;
};
