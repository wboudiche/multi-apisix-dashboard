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

/** Certificates within this many days are worth saying something about. */
export const EXPIRY_WARNING_DAYS = 30;

export type CertExpiry = {
  /** Whole days from now; negative once the certificate has expired. */
  days: number;
  state: 'expired' | 'soon' | 'ok';
};

/**
 * What a certificate's expiry means right now, from the date the proxy read
 * out of it (`__cert_not_after`, RFC 3339).
 *
 * Whole days rather than hours: the list answers "is this worth my attention
 * this week", and an hour-level countdown in a table column is noise. Undefined
 * for a row the proxy could not read a certificate from - which the column then
 * says nothing about, rather than showing a date it invented.
 */
export const certExpiry = (
  notAfter: unknown,
  now: Date = new Date()
): CertExpiry | undefined => {
  if (typeof notAfter !== 'string' || !notAfter) return undefined;

  const end = new Date(notAfter);
  if (Number.isNaN(end.getTime())) return undefined;

  const days = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
  return {
    days,
    state: days < 0 ? 'expired' : days <= EXPIRY_WARNING_DAYS ? 'soon' : 'ok',
  };
};
