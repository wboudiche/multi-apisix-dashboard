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

/*
 * Where the app shell goes and where an instance is needed, decided from the
 * pathname the router hands over.
 *
 * That pathname is base-relative. `basepath` is set once in
 * `src/config/global.ts`, and router-core takes it off on the way in — for
 * exactly `/ui` or a `/ui/` prefix, separator included (`rewriteBasepath`,
 * router-core 1.171.28). `useLocation().pathname` and the `location` given to
 * `beforeLoad` therefore never carry it.
 *
 * Both of these used to allow for it anyway: two dead comparisons against
 * `/ui/login` and `/ui/change-password`, and a `pathname.replace(/^\/ui/, '')`
 * that was not anchored to a separator. The comparisons never matched. The
 * replace matched more than the base ever will — a route named `ui` came out
 * as `''`, the app root, and `/uikit` as `kit` — and the day such a route is
 * added, the instance guard gets it wrong with nothing to point at (#169).
 *
 * The base belongs in one place, `appUrl` in `src/utils/app-url.ts`, for the
 * URLs the browser is handed directly. Here it is simply not a thing that
 * happens, so it is not a thing to strip.
 */

/** The login screen, which renders without the app shell and without a session. */
export const isLoginPath = (pathname: string): boolean => pathname === '/login';

/** The forced password change, the other screen that renders on its own. */
export const isChangePasswordPath = (pathname: string): boolean =>
  pathname === '/change-password';

/**
 * Pages that operate against an APISIX instance, and therefore need one
 * selected to make sense.
 *
 * The multi-tenant management pages and the landing pages do not: overview
 * aggregates across instances, and instances/teams/users are admin CRUD that
 * lives entirely in the dashboard's own etcd.
 */
export const requiresInstance = (pathname: string): boolean =>
  // '/login' stays in the list although the app shell never asks about it: this
  // answers for a path, not for a call site. '' does not, because the router
  // gives a pathname that always begins with a slash.
  !['/', '/login', '/overview', '/instances', '/teams', '/users'].includes(pathname) &&
  !pathname.startsWith('/instances/') &&
  !pathname.startsWith('/teams/') &&
  !pathname.startsWith('/users/');
