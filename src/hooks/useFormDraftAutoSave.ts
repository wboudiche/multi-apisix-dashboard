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
import { useCallback, useEffect, useRef } from 'react';
import { type UseFormReturn, useWatch } from 'react-hook-form';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useFormDraftAutoSave = (key: string, form: UseFormReturn<any>) => {
  const watchedValues = useWatch({ control: form.control });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedRef = useRef(false);

  // Auto-save with debounce
  useEffect(() => {
    if (clearedRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (clearedRef.current) return;
      try {
        // Only save once the user actually changed something — forms with
        // pre-filled defaults (e.g. routes) would otherwise save a draft on
        // every visit before any input
        if (!form.formState.isDirty) return;
        const values = form.getValues();
        // Only save if there's meaningful data
        if (values.name || values.uri || values.uris?.length) {
          localStorage.setItem(key, JSON.stringify(values));
        }
      } catch {
        // Ignore serialization errors
      }
    }, 1500);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [watchedValues, key, form]);

  const clearDraft = useCallback(() => {
    clearedRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    localStorage.removeItem(key);
  }, [key]);

  const hasDraft = useCallback(() => {
    return !!localStorage.getItem(key);
  }, [key]);

  return { clearDraft, hasDraft };
};
