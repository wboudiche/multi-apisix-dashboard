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
import { z } from 'zod';
import { init } from 'zod-empty';

/**
 * A string that has to be filled, with one sentence for every way of being
 * empty: never typed in is `undefined`, which zod refuses before `min` is
 * asked, and each would otherwise need the key written again.
 *
 * `key` is a translation key: the field shows what it says (see errorText).
 */
export const requiredString = (key: string) =>
  z.string({ required_error: key, invalid_type_error: key }).min(1, key);

export const zGetDefault = init;
