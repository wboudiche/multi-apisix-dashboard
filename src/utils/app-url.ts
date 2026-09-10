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
import { BASE_PATH } from '@/config/constant';

/**
 * An in-app route as a URL the browser can be sent to directly.
 *
 * The app is served under a base path, and everything that navigates through
 * the router gets it applied for free: `basepath` is set once in
 * `src/config/global.ts`, so `navigate({ to: '/login' })` goes to `/ui/login`
 * and `useLocation().pathname` comes back with the base already stripped.
 *
 * `window.location.href` gets none of that. It is a raw browser URL, and a
 * route written the way the router takes it lands outside the app — which is
 * how #163 happened: an expired session was sent to `/login`, which is a 404
 * from the gateway serving the built app and a "did you mean /ui/login?" page
 * from the dev server.
 *
 * So: use the router where there is one. Where there is not — an interceptor,
 * which has no component and no hook, and wants the full reload anyway because
 * the session it is reacting to is gone — build the URL here rather than
 * writing the base out by hand.
 */
export const appUrl = (path: string): string =>
  `${BASE_PATH.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
