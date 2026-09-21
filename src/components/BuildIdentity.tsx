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
import { useTranslation } from 'react-i18next';

import { abbreviatedSha, branch } from '~build/git';
import buildTime from '~build/time';

/**
 * Which build this page is.
 *
 * The dashboard is served two ways: the vite dev server, and the official
 * image (the root Dockerfile), which is only as fresh as the release it was
 * built from. Nothing on screen said so once: a months-old page looked exactly
 * like a current one, #221 was reported from such a page about behaviour fixed
 * long before it, and cost a full investigation (#237).
 *
 * The values come from `unplugin-info`, which shells out to git at build time -
 * which is why the Dockerfile installs git and keeps .git in the context.
 */
export const BuildIdentity = () => {
  const { t } = useTranslation();

  // UTC, and deliberately ISO: a build stamp read in five languages, pasted
  // into a ticket and compared against a commit date is better unambiguous
  // than local.
  const date = new Date(buildTime).toISOString().slice(0, 10);

  // unplugin-info answers null for every git field when it is built outside a
  // repository - a source tarball, or a docker build whose context carries a
  // worktree's .git file pointing somewhere the build cannot see. Left to
  // interpolation that reads "Build  (), 2026-09-18", which looks like an
  // answer. Say it plainly instead.
  if (!abbreviatedSha) {
    return (
      <Text size="xs" c="dimmed">
        {t('header.buildUnknown', { date })}
      </Text>
    );
  }

  return (
    <Text size="xs" c="dimmed">
      {t('header.build', {
        sha: abbreviatedSha,
        branch,
        date,
        // i18next escapes interpolations for markup by default, and that
        // includes the slash: a branch called fix/237-x reached the screen as
        // fix&#x2F;237-x, which is not something anyone can paste back.
        interpolation: { escapeValue: false },
      })}
    </Text>
  );
};
