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
 * The date a record was written, as a column should show it.
 *
 * A Go struct with no date set serializes its `time.Time` as
 * `"0001-01-01T00:00:00Z"`, and that string is not empty: the Users page
 * formatted it and every account, including the bootstrap admin, was dated
 * 01/01/1 (#300). Accounts stored before the backend stamped anything still
 * carry it, and their real date is gone - so this reads as unknown rather
 * than being filled with a date nobody set.
 *
 * Undefined for anything that is not a date the record actually carries:
 * missing, empty, unparseable, or year 1. The caller decides what unknown
 * looks like.
 */
export const recordDate = (value?: string | null): string | undefined => {
  if (typeof value !== 'string' || !value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  // Read in UTC, as the zero time is written: a local reading of it lands in
  // year 1 or year 0 depending on the offset, so `<= 1` covers both.
  if (date.getUTCFullYear() <= 1) return undefined;

  return date.toLocaleDateString();
};
