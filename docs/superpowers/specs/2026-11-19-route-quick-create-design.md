# Route quick create - design

## Why

A route that works needs three things: a path, somewhere to send it and,
for the dashboard, a name. The add page asks for them through a five-step
wizard of about thirty fields (15 on the first step, 14 for new nodes on
the second, then request override, plugins and a preview), almost all of
them advanced. The common case - expose a path to a backend - costs five
screens.

## Goal

The routes list's **Create** opens a one-screen dialog that creates a
working route from a path and a destination. The wizard stays, unchanged,
for everything else, and the dialog hands over to it without losing what
was typed.

> Since #439 the list names both ways in: **Quick route** opens this dialog
> and **Advanced route** links straight to the wizard. The dialog's
> **More options…** is labelled **Continue in the advanced form**.

Non-goals: changing the wizard (part 2 of the proposal), duplicating a
route onto another upstream (part 3), templates.

Anti-goals: a route created by the dialog that differs from what the
wizard would have created from the same answers; a second place where
the duplicate check, the team or the error reporting behave differently.

## Approaches

1. **A dialog on the list, handing over to the wizard (chosen).** One
   screen for the common case; the wizard is one click away and starts
   from the dialog's answers through the wizard's own draft.
2. **A slimmer wizard only.** Keeps one path, but a simple route is still
   several screens. Kept as part 2.
3. **A separate quick-create page.** Same content as the dialog, one more
   navigation and nothing gained.

## The dialog

```
Path *        [ /api/orders/*                       ]
Methods       [GET] [POST] [PUT] [DELETE] ...  (none = all)
Destination * (•) URL   ( ) Existing upstream   ( ) Service
              [ http://10.0.0.5:8080                ]
Host          [ api.example.com                     ]  (optional)
Name *        [ GET /api/orders/*                   ]  (proposed)
⚠ A route already matches this path: orders-v1
More options…                  [Cancel] [Create offline] [Create]
```

- **Path**: required, as in the wizard's schema.
- **Methods**: the wizard's default (GET, POST, PUT, DELETE) pre-selected;
  none selected means every method, as in APISIX.
- **Destination**:
  - *URL* - `http(s)://host[:port][/base]`, turned into an inline upstream
    by `upstreamFromServer` (`src/utils/openapi-import.ts`), the same
    function the OpenAPI import uses: roundrobin, the URL's scheme,
    `pass_host: node`, one node with the port defaulted from the scheme. A
    base path becomes a `proxy-rewrite` prefix, as the importer does. The
    wizard's default timeouts (6s) are added, so the route is the one the
    wizard would have built.
  - *Existing upstream* / *Service*: a searchable select of the active
    instance's upstreams or services (`useAllUpstreams`, `useAllServices`).
- **Host**: optional, one host (`host`).
- **Name**: proposed from the methods and the path until the user types
  in it; required.
- **Duplicate warning**: the existing `findRouteDuplicates` against the
  instance's routes, shown in the dialog as the path and methods change;
  creating anyway is allowed, as on the wizard (APISIX allows it).
- **Create / Create offline**: `status` 1 or 0, posted through the same
  `postRouteReq` + `produceRoute` as the wizard, so the team header, the
  proxy's checks and the error text (`proxyFailureText`) are the same. On
  success: the wizard's success notification, the dialog closes, the list
  refreshes.
- **More options…**: writes the dialog's answers as the wizard's draft
  (`apisix-route-draft`) and opens `/routes/add`, which restores it with
  its existing "draft restored" notice. A draft already there is replaced
  only after a confirmation.

## Constraints

- Every visible string through `t()`, with the key in all five languages
  (`locale-keys.test.ts`).
- ASF header on new files; `apiClient` vs `req` as in CLAUDE.md (`req`
  here).
- The Create button keeps its permission gate (`canCreate`).

## Left to the builder

Component and file names, the exact debounce of the duplicate check, the
layout within the dialog, and which e2e specs grow to cover it.
