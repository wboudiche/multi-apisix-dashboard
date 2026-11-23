# Quick route: Keycloak token access — design

Status: draft, 2026-11-23. Builds on the quick route page (#423, #447) and
Keycloak client provisioning (#459).

## Intent

The most common route made from the quick route page is an API called by
another backend. Today its "Who can call it" offers anyone, an API key
(`key-auth`) or a username and password (`basic-auth`). An API protected by a
Keycloak token — the caller gets one by Client Credentials and sends it as a
bearer — needs the advanced form, and a client created only after the route
has been saved. This adds that case to the quick route page, in one screen.

## Goals

- A fourth access choice, **Keycloak token**, on the quick route page.
- Create a Keycloak client for the new route, or reuse one the dashboard
  created earlier, without leaving the page.
- The route accepts only its own client's tokens (audience check of #459).
- After a creation, show the client id and secret once, so the caller's
  application can be configured.
- A failure leaves nothing behind: no route, no open route.

## Non-goals

- Browser login (Authorization Code + PKCE). It needs a redirect address,
  a session and cookies; it stays in the advanced form, which the choice
  links to.
- Entering a client's values by hand. That is the advanced form's.
- Any change to the backend or to its checks on client creation.

## Anti-goals

- A route that is reachable without a token at any moment, even when a step
  fails.
- The client secret written to a draft, a log, or any storage of the browser.

## Constraint that shapes it

The backend creates a client only for a route that exists on the gateway
(`api/internal/handlers/idp_clients.go`, `route_id is required`, then the
route is read and its owner checked). The quick route page posts a new route
in one call. Reusing a client needs no route.

## Approaches considered

1. **Chain the calls, route disabled first** — chosen. Create the route
   disabled, create the client for it, then put `openid-connect` on the
   route and give it the status asked for. No backend change; the security
   checks reviewed in #459 stay as they are.
2. Let the backend create a client before its route (with the id the route
   will get). One call from the page, but the owner and host checks have no
   route to read, and clients could be made for routes that never exist.
3. Reuse only. Simplest, but the first client must be made elsewhere, which
   is most of what the choice is for.

## Design

### The choice

- `Keycloak token` is offered when the current instance has a linked
  connection the caller may create with (an admin, or a connection with
  `developers_can_create`), or a created client the caller can reuse — the
  same rule as `KeycloakClientPicker` (`oidcClientApi.linked`, `.list`).
  Otherwise it is not shown.
- Not offered when duplicating a route: a copy keeps the original's plugins,
  as for the other authentications. Not offered either when the chosen
  service already sets an authentication plugin (the page's existing rule).
- Its section holds:
  - **Client**: *Create a new client* (default when the caller may create) or
    *Reuse a client* (a select of the instance's created clients).
  - Create: the connection (preselected when there is one), the client id
    suffix after the connection's prefix (proposed from the route's name,
    else its path, with `proposeClientIdSuffix`), the validation —
    **JWKS** (default: no call to Keycloak per request) or introspection —
    and client credentials on (the point of the choice).
  - A line linking to the advanced form for a browser login.

### Saving (create)

1. `POST` the route with `status: 0`, without `openid-connect`.
2. `POST /idps/:id/clients` with the route's id, `mode: token`, the options
   above.
3. `PATCH` the route: `openid-connect` built with `applyClientCredentials`
   (`bearer_only: true`, the audience check), and the status asked for
   (published or draft).

Reuse: `POST /instances/:id/oidc-clients/:uuid/use` first, then the route is
posted once, with the plugin and the asked status.

### Failure (the user's rule: the route is deleted)

- Step 2 fails: the route is deleted. The error says why the client could not
  be made.
- Step 3 fails: the route is deleted. The client now has no route: an admin
  deletes it at once (found by its client id in the instance's client list);
  for a developer, who may not delete clients, the message says it is listed
  under Settings → OIDC clients as "no route" for an admin to remove.
- The deletion itself fails: the route stays, but disabled, and the message
  names it with a link. It never opens without its plugin.
- Reuse fails (410: gone from Keycloak, or any error): nothing has been
  posted; the error is shown on the form.

### After success

A dialog shows the client id, the secret and the token endpoint, each with a
copy button, and says the secret is shown once (it is not stored by the
dashboard and can be read again only in Keycloak). Closing it goes where the
page goes today after a creation. A reused client shows its id only.

### Secret handling

The secret lives in component state for the dialog only: never in the form
answers the quick route page saves as a draft, never in a mutation cache
(reset after use, as the picker does).

## Tests

- Unit: the chaining and each failure branch (route deleted, client deleted
  for an admin, message for a developer, disabled route kept when deletion
  fails); the plugin produced (bearer_only, JWKS / introspection, audience);
  the choice hidden without a usable connection.
- e2e (Keycloak in the e2e compose): create a quick route with a new client,
  get a token by Client Credentials, call the route through the gateway —
  401 without a token, 200 with it, 403 with another client's token; reuse a
  client; a forced client-creation failure leaves no route.

## Left to the builder

Component split, i18n keys (five languages), exact wording, and how the
dialog is laid out.
