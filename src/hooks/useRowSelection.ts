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
import { useState } from 'react';

/**
 * The rows ticked among the ones on screen, in the order they were ticked.
 *
 * What was ticked and is not shown is not selected: a row on another page,
 * one a filter took out of the list, one that has since been deleted.
 */
export const visibleSelection = (
  ticked: readonly string[],
  visibleIds: readonly string[]
): string[] => {
  const visible = new Set(visibleIds);
  return ticked.filter((id) => visible.has(id));
};

/**
 * The selection of a list page: the rows ticked, among the rows it shows.
 *
 * A list page kept the ids it was given in state for as long as it was
 * mounted, and handed all of them to Batch Delete. Two rows ticked on page
 * one were still selected on page two, where nothing showed them: the
 * selection bar came back at the first row ticked there reading "3 selected",
 * and the delete took the two routes that were not on screen (#371). A row
 * deleted from its own menu stayed in the set too, and failed the next batch.
 *
 * So the selection is never more than what the page shows. It is derived on
 * each render rather than pruned by an effect: there is no moment between a
 * page change and the pruning in which the old ids are still the selection.
 *
 * Whatever sets it is given what the page shows as selected to start from -
 * a table's own onChange is - so ticking a row on page two drops the ticks
 * of page one rather than carrying them along.
 */
export const useRowSelection = (visibleIds: readonly string[]) => {
  const [ticked, setTicked] = useState<string[]>([]);
  return [visibleSelection(ticked, visibleIds), setTicked] as const;
};
