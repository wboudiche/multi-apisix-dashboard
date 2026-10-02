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
import { useCallback, useMemo, useState } from 'react';

/** What was ticked, and the list it was ticked on. */
export type Ticked = { listKey: string; ids: readonly string[] };

/**
 * The rows selected on a list: the ones ticked on that very list - the same
 * instance, page and filters - that it still shows, in the order they were
 * ticked.
 *
 * What was ticked on another list is not selected, however alike the ids: two
 * gateways number their routes from the same 1, and a route ticked on staging
 * must not arrive ticked on production. What was ticked here and is no longer
 * shown - deleted from its own menu, or by someone else - is not selected
 * either.
 */
export const selectionOf = (
  ticked: Ticked,
  listKey: string,
  visibleIds: readonly string[]
): string[] => {
  if (ticked.listKey !== listKey) return [];
  const visible = new Set(visibleIds);
  return ticked.ids.filter((id) => visible.has(id));
};

/** A selection to replace the current one with, or how to get it from it. */
export type SelectionUpdate = readonly string[] | ((selected: string[]) => readonly string[]);

/**
 * What a change of selection leaves ticked.
 *
 * A change made for another list than the one the ticks are on changes
 * nothing. The page stays usable while a batch is being answered, so the
 * change a batch confirmed on page one asks for can arrive once page two is
 * shown and ticked: applied, it wiped ticks it was never about.
 *
 * An update given as a function starts from everything ticked on the list,
 * as it is when the update is applied - so two toggles before a render keep
 * both, and one asked for a while ago does not undo what was ticked since.
 */
export const tickedAfter = (ticked: Ticked, listKey: string, update: SelectionUpdate): Ticked => {
  if (ticked.listKey !== listKey) return ticked;
  return { listKey, ids: typeof update === 'function' ? update([...ticked.ids]) : update };
};

/**
 * The selection of a list page.
 *
 * A list page kept the ids it was given in state for as long as it was
 * mounted, and handed all of them to Batch Delete. Two rows ticked on page
 * one were still selected on page two, where nothing showed them: the
 * selection bar came back at the first row ticked there reading "3 selected",
 * and the delete took the two routes that were not on screen (#371). A row
 * deleted from its own menu stayed in the set too, and failed the next batch.
 *
 * So a selection belongs to the list it was made on - `listKey`, which the
 * list hooks return and which changes with the instance, the page, the
 * filters and the team - and is never more than what that list shows.
 *
 * The ticks are forgotten when another list is shown, while rendering - which
 * React allows for exactly this, state that follows what a component is given,
 * and which, unlike an effect, shows no frame of the old selection in between.
 *
 * Within a list they are kept while their row is away, not dropped: a gateway
 * that cannot be reached answers as an empty list, and a selection dropped
 * with every row that left the screen was lost to one failed refetch - the
 * rows came back unticked. What a batch deleted is taken out by the batch
 * (see BatchDeleteBtn), so that a row made again under the same id does not
 * arrive ticked.
 */
export const useRowSelection = (visibleIds: readonly string[], listKey: string) => {
  const [ticked, setTicked] = useState<Ticked>({ listKey, ids: [] });

  // The ids by value: a page builds the array anew on every render, and a
  // selection that changed identity each time would have a table redo its
  // own work for nothing.
  const visibleKey = JSON.stringify(visibleIds);
  const visible = useMemo(() => JSON.parse(visibleKey) as string[], [visibleKey]);

  const selected = useMemo(
    () => selectionOf(ticked, listKey, visible),
    [ticked, listKey, visible]
  );
  if (ticked.listKey !== listKey) setTicked({ listKey, ids: [] });

  const setSelected = useCallback(
    (update: SelectionUpdate) => setTicked((current) => tickedAfter(current, listKey, update)),
    [listKey]
  );
  return [selected, setSelected] as const;
};
