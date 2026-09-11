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
import type { CommonPOM } from '@e2e/pom/type';
import { expect, type Locator, type Page } from '@playwright/test';

import { PAGE_SIZE_MAX } from '@/config/constant';
import type { FileRouteTypes } from '@/routeTree.gen';

import { env } from '../env';

export const uiGoto = <T extends FileRouteTypes['to']>(
  page: Page,
  path: T,
  params?: T extends `${string}$${string}` ? Record<string, string> : never
) => {
  let finalPath = path as string;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      finalPath = finalPath.replace(`$${key}`, value);
    });
  }
  return page.goto(`${env.E2E_TARGET_URL}${finalPath.substring(1)}`);
};

export const uiHasToastMsg = async (
  page: Page,
  ...filterOpts: Parameters<Locator['filter']>
) => {
  const alertMsg = page.getByRole('alert').filter(...filterOpts);
  // Increased timeout for CI environment (30s instead of default 5s)
  await expect(alertMsg).toBeVisible({ timeout: 30000 });
  await alertMsg.getByRole('button').click();
  await expect(alertMsg).not.toBeVisible();
};

export async function uiCannotSubmitEmptyForm(page: Page, pom: CommonPOM) {
  await pom.getAddBtn(page).click();
  await pom.isAddPage(page);
  await uiHasToastMsg(page, {
    hasText: 'invalid configuration',
  });
}

export async function uiFillHTTPStatuses(
  input: Locator,
  ...statuses: string[]
) {
  for (const status of statuses) {
    await input.fill(status);
    await input.press('Enter');
  }
}

export const uiClearMonacoEditor = async (page: Page) => {
  await page.evaluate(() => {
    const editor = window.__monacoEditor__;
    editor.getModel()?.setValue('');
  });
};

export const uiGetMonacoEditor = async (
  page: Page,
  parent: Locator,
  clear = true
) => {
  // Wait for Monaco editor to load
  const editorLoading = parent.getByTestId('editor-loading');
  await expect(editorLoading).toBeHidden();
  const editor = parent.locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 10000 });

  if (clear) {
    await uiClearMonacoEditor(page);
  }

  return editor;
};

export const uiFillMonacoEditor = async (
  page: Page,
  editor: Locator,
  value: string
) => {
  await editor.click();
  const editorTextbox = editor.getByRole('textbox');
  // Use fill() instead of pressSequentially() for reliability
  await editorTextbox.fill(value);
  await editor.blur();
  await page.waitForTimeout(800);
};

/**
 * Reload the current list page with every row on it, and wait until it is on
 * screen.
 *
 * List pages open on page 1 at PAGE_SIZE_MIN. A spec looking there for the row
 * it just created is betting the gateway holds fewer than ten others — true of
 * CI's fresh stack, false of any local one an earlier run left rows in (#151).
 * The list pages read page and page_size from the URL. PAGE_SIZE_MAX is the
 * largest size the dashboard itself asks for; the URL schema does not cap it.
 *
 * Waiting matters as much as widening. page.goto returns at `load`, before the
 * list's request comes back, and the table renders only once the route loader
 * has it — so a check of *absence* made straight after the reload passes on a
 * page with no table yet, whether or not the row exists. The first version of
 * this helper did exactly that, and turned the CRUD specs' "the delete worked"
 * check into one that could not fail.
 */
export const uiShowAllRows = async (page: Page) => {
  const url = new URL(page.url());
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', String(PAGE_SIZE_MAX));

  // The list's own request: the page's last path segment names the resource,
  // and no other query on these pages asks for that resource at this size.
  // A successful one only — the list hooks render a gateway error as an empty
  // table, which would read as every row being absent.
  const resource = url.pathname.split('/').filter(Boolean).pop();
  const listed = page.waitForResponse((res) => {
    const u = new URL(res.url());
    return (
      res.ok() &&
      res.request().method() === 'GET' &&
      u.pathname.endsWith(`/apisix/admin/${resource}`) &&
      u.searchParams.get('page_size') === String(PAGE_SIZE_MAX)
    );
  });
  await page.goto(url.toString());
  await listed;
  await expect(page.locator('.ant-table').first()).toBeVisible();
};
