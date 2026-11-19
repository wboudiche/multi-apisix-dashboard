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
import { useEffect, useState } from 'react';

/**
 * Whether a scroll container's content is wider than it is, kept up to date
 * as either changes size: the page is resized, rows arrive, a column is
 * shown. For a table's pinned column to be set off only when something
 * actually scrolls under it.
 *
 * The ref is a callback: the container can mount after the first render,
 * once its rows have loaded, and is observed from whenever it does.
 */
export const useOverflowX = <T extends HTMLElement>() => {
  const [el, setEl] = useState<T | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    if (!el) return undefined;
    // Called by the observer only, which calls it once on observing: the
    // first answer comes with the first layout, not before it.
    const observer = new ResizeObserver(() => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    });
    observer.observe(el);
    const table = el.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [el]);

  return [setEl, overflowing] as const;
};
