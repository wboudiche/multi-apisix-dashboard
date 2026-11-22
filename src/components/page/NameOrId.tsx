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
import { Text } from '@mantine/core';

/**
 * A record's name in a list whose ID column is hidden - or, for one with no
 * name, since a name is optional, its ID, quieter: without it the row would
 * say nothing of which record it is.
 */
export const NameOrId = ({ value }: { value: { name?: string; id?: string } }) =>
  value.name ? (
    <>{value.name}</>
  ) : (
    <Text span c="dimmed" ff="monospace" fz="sm">
      {value.id}
    </Text>
  );
