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
 * The props a resource list's ProTable takes so that its ID column is hidden
 * until asked for: the ID is the key APISIX knows a record by, worth a look
 * now and then, but nobody reads a list by it - the name is what it shows.
 * The table's column setting (the gear above it) brings it back.
 */
export const idColumnHidden = {
  options: { setting: true, density: false, reload: false, fullScreen: false },
  columnsState: { defaultValue: { id: { show: false } } },
} as const;
