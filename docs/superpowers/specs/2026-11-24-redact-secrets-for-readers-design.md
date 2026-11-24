# Redact credentials for callers who may not write — design

Status: approved, 2026-11-24. Issue #463.

## Intent

The Admin API proxy returns resources as APISIX stores them, credentials included. A viewer of a team reads a route's `openid-connect` `client_secret` (client credentials on since #459/#462) or a consumer's key-auth key, and can then call the API as that client. Reading a resource must not be enough to act as its client.

## Goal

A GET through the proxy answers `"***"` in place of every credential field when the caller may not write that resource.

## Non-goals

- Hiding credentials from writers (developers on their own types, admins): they keep seeing and copying them, and saving a form keeps working unchanged.
- A "reveal" endpoint, audit logging.
- Which team sees which plugin config / secret (#455); secrets kept in form drafts (#461).

## Approaches considered

1. **Redact for callers who may not write** — chosen. Writes are untouched (a viewer cannot write; a developer cannot write the read-only types), so no merge-on-PUT is needed and no form changes behaviour.
2. Redact for everyone but admins, restore on PUT when the marker comes back. Stronger, but breaks "copy the key" in the auth plugin forms and touches every save path.
3. Always redact, reveal on request. Most complete, most expensive.

## Design

### Who gets redacted

On a read (GET) through `ProxyRequest` (`api/internal/handlers/proxy.go`), redact when the caller may NOT write the resource:

- `!models.HasResourcePermission(effRole, resourceType, "write")` — a viewer on everything; a developer on the types they read but do not write (`plugin_configs`, `global_rules`, `ssls`, `secrets`, `plugin_metadata`, …);
- otherwise not redacted. (Team-owned types already refuse another team's detail and filter a non-admin's lists, so a writer only ever reads resources of teams they write to.)

Admins and super admins are never redacted.

### What is redacted

The JSON answer is walked at any depth (detail `{key, value}`, lists `{list: [...]}` / `{total, list}`, and APISIX's empty-table `{}`) and a field's value — any JSON type, when not null/empty — is replaced by the string `"***"`:

- **By name, anywhere:** `client_secret`, `secret`, any key ending in `_secret` (e.g. `secret_key`), `password`, `private_key`, any key ending in `_private_key` (e.g. `client_rsa_private_key`), `client_key`, `secret_access_key`.
- **By context only** (the bare words are common elsewhere — `limit-count` has `key: remote_addr`):
  - `key` directly inside a `key-auth` plugin object;
  - `key` and `keys` at the top of an SSL object (resource type `ssls`);
  - `token` at the top of a `secrets` resource object (vault).

A field whose value is an object/array under a matched name is replaced whole.

The walk works on decoded JSON (`any`); an answer that is not JSON, or an error answer, is passed through unchanged. Headers are adjusted (`Content-Length`) for the rewritten body.

### Where

A pure function `redactCredentials(resourceType string, body []byte) []byte` (new file `api/internal/handlers/redact.go`) called in `ProxyRequest` after the upstream answer is read and after the existing list filtering, only for GET and only when the rule above says so. The other read paths that return resource bodies to the browser (check `ListRoutes`/`ListServices`/`ListUpstreams` aliases, the route-test / overview / reassign handlers) are reviewed: any that returns plugin configuration to a non-writer goes through the same function.

### UI

No change expected: the viewer's detail pages and read-only forms show `***`. Check the "copy" buttons of `AuthClientsSection` are not offered to a viewer, or copy `***` harmlessly.

## Tests

- Go, table-driven, on `redactCredentials`: each named field at depth (route plugins, service plugins, consumer plugins, credential plugins, plugin_config, global_rule), `key-auth.key` redacted vs `limit-count.key` kept, SSL `key`/`keys` redacted and `cert` kept, vault `token`, list and detail shapes, empty tables, non-JSON passthrough.
- Go, handler level: viewer GET → redacted; developer GET on a route → not redacted; developer GET on a plugin_config/global_rule → redacted; admin → not redacted; writes untouched.
- e2e: a viewer opens a route holding `openid-connect` with a `client_secret` and a consumer with `key-auth`: neither secret appears in the page nor in the API answer the page received.
