# Route Label Classification System — Design Spec

## Overview

Add a label-based classification system to the APISIX Dashboard routes page, combining tag-based filtering (Option A) with grouped table views (Option B). Labels are managed as a taxonomy by admins, and developers assign them to routes for classification, filtering, and grouping.

## Decisions

| Area | Decision |
|------|----------|
| Taxonomy | Admin-managed keys + values, per-instance, stored in etcd |
| RBAC | Admins create/edit taxonomy, developers assign existing labels to routes |
| Color | Per label key, admin-assigned from a preset palette (WCAG AA contrast) |
| Admin page | `/labels` top-level route with sidebar entry (admin only) |
| Filter bar | Dropdowns per key + dismissable active filter chips |
| Filter logic | OR within same key, AND across keys — client-side on full dataset |
| Grouping | Up to 2-level multi-level grouping via toolbar selector |
| Badges | Color-coded by key, clickable to filter, orphan handling |
| Quick-add | Admins can add new values from route page dropdowns |
| Scope | Routes only (not services, upstreams, consumers) |

## 1. Data Model

### etcd Storage

**Key prefix:** `/labels/{instance_id}/{key_name}`

Labels are **per-instance** — each APISIX instance has its own label taxonomy. The prefix follows the codebase convention of flat top-level prefixes with instance scoping as the first path segment (same pattern as `/ownership/{instanceID}/...`). Add `KeyPrefixLabels = "/labels/"` to the constants in `models.go`.

```json
{
  "key": "env",
  "display_name": "Environment",
  "color": "#4263eb",
  "values": ["production", "staging", "development"],
  "created_by": "admin-user-id",
  "created_at": 1710000000,
  "updated_at": 1710000000
}
```

### Field Definitions

- `key` — Label key used in APISIX routes' native `labels` field. Lowercase, alphanumeric + underscores only, max 32 characters (e.g., `env`, `team`, `api_version`). Must be unique within the instance. Auto-generated from display name by lowercasing and replacing spaces/special chars with underscores.
- `display_name` — Human-readable name shown in the UI (e.g., "Environment", "Team"). Max 64 characters.
- `color` — Hex color from a preset palette of 12 Mantine theme colors at shade 6: red, pink, grape, violet, indigo, blue, cyan, teal, green, lime, yellow, orange. Preset palette ensures WCAG AA contrast ratios for badge readability. Admin picks from swatches, no free-form hex input.
- `values` — Ordered list of allowed values for this key. Each value: max 64 characters, no colons, unique within the key (case-insensitive). Order is preserved in dropdowns.
- `created_by` — User ID of the admin who created the label key.
- `created_at` / `updated_at` — Unix timestamps.

### Route Integration

Routes continue using APISIX's native `labels` field: `{"env": "production", "team": "payments"}`. No change to the route schema. The taxonomy is enforced at the dashboard API layer before proxying to APISIX.

### RBAC

| Role | Taxonomy (keys/values) | Assign labels to routes |
|------|----------------------|------------------------|
| `super_admin` | Full CRUD | Yes |
| `instance_admin` | Full CRUD | Yes |
| `developer` | Read only | Yes |
| `viewer` | Read only | No |

Add `labels:read` and `labels:write` permissions to the `RolePermissions` map in `models.go`. `labels:write` granted to `super_admin` and `instance_admin`. `labels:read` granted to all roles.

**Note:** The existing RBAC middleware only does role-based checks (super admin bypass, viewer GET-only), not permission-based checks. For label endpoints, add a simple role-based guard on the `/api/v1/labels` route group: `GET` open to all authenticated users, `POST/PUT/DELETE` restricted to `super_admin` and `instance_admin` via a new lightweight middleware (similar to how admin-only routes are protected in `cmd/main.go`). The `RolePermissions` map entries serve as documentation and future-proofing for when permission-based RBAC is implemented.

## 2. Backend API

### New Endpoints

| Method | Path | Description | Roles |
|--------|------|-------------|-------|
| `GET` | `/api/v1/labels` | List all label keys with values for current instance | all |
| `POST` | `/api/v1/labels` | Create a label key | super_admin, instance_admin |
| `PUT` | `/api/v1/labels/{key}` | Update label key (display name, color, values) | super_admin, instance_admin |
| `DELETE` | `/api/v1/labels/{key}` | Delete label key | super_admin, instance_admin |

All endpoints require `X-Instance-ID` header (same as all other dashboard endpoints). The backend resolves the instance and scopes etcd operations to `/labels/{instance_id}/`.

### Go Model

Add a `Label` struct to `models.go`:

```go
type Label struct {
	Key         string   `json:"key"`
	DisplayName string   `json:"display_name"`
	Color       string   `json:"color"`
	Values      []string `json:"values"`
	CreatedBy   string   `json:"created_by"`
	CreatedAt   int64    `json:"created_at"`
	UpdatedAt   int64    `json:"updated_at"`
}
```

### API Response Format

Follows existing conventions:

- **List:** `{ "list": [...], "total": N }`
- **Create/Update:** `{ "value": {...} }`
- **Delete:** `204 No Content`

### Route Label Validation

**Intercept point:** Add a pre-proxy middleware for route create/update requests. The proxy handler (`proxy.go`) currently forwards all APISIX Admin API requests transparently. Add a new middleware that:

1. Inspects the request path — only triggers for `PUT /apisix/admin/routes/*` and `POST /apisix/admin/routes`
2. Reads and parses the request body
3. If `labels` field is present, validates each key-value pair against the instance's label taxonomy in etcd
4. If valid, reconstructs the request body and forwards to APISIX
5. If invalid, returns `400` with error: `{"error": "Invalid label: key 'foo' is not defined in the label taxonomy"}` or `{"error": "Invalid label value: 'bar' is not an allowed value for key 'env'. Allowed: production, staging, development"}`
6. If no `labels` field is present, passes through unchanged

This middleware runs after RBAC but before the proxy forward. It is added to the proxy group's middleware chain in `cmd/main.go`:

```go
proxy := protected.Group("/apisix")
proxy.Use(middleware.RBACMiddleware(authService))
proxy.Use(middleware.LabelValidationMiddleware(labelService))  // new
```

This requires adding `labelService` as a dependency in `setupRouter()` and wiring it through the dependency injection in `main()`.

### Backend Files

- New `handler/label.go` — CRUD handlers for label taxonomy
- New `service/label.go` — Business logic + etcd operations under `/labels/{instance_id}/`
- New `middleware/label_validation.go` — Pre-proxy validation middleware for route requests
- Update `models/models.go` — Add `labels:read` and `labels:write` to `RolePermissions`
- Update `cmd/main.go` — Register label routes and middleware

### Value Removal Safety

When an admin removes a value from a label key (e.g., removes "staging" from `env`), existing routes with that value are not modified. The removed value becomes orphaned on those routes. The UI surfaces orphaned values so admins can clean up routes before or after removal.

## 3. Frontend — Label Admin Settings Page

### Location

New top-level route: `/labels`. Add a sidebar entry under the administration section (visible to `super_admin` and `instance_admin` only). This follows the pattern of other admin pages like Teams and Roles.

**Files:**
- New `src/routes/labels/index.tsx` — Page component
- Update `src/components/nav/navRoutes.ts` — Add sidebar entry (requires adding `labels` to `NavRoute['to']` type and `common.sources.labels` i18n key)
- Route tree auto-generates via TanStack Router file-based routing

### Page Layout

- Page title: i18n key `labels.page.title` ("Label Management")
- "Add Label Key" button top-right
- Table with columns: Display Name, Key, Color (swatch), Values (comma-separated preview), Actions (edit, delete)

### Add/Edit Modal

- **Display Name** — Text input (e.g., "Environment"). Required, max 64 chars.
- **Key** — Slug input, auto-generated from display name on create, read-only on edit (e.g., "env"). Shows validation: lowercase, alphanumeric + underscores, max 32 chars, unique within instance.
- **Color** — Color swatch picker with 12 preset Mantine colors. No free-form hex input.
- **Values** — TagsInput where admin types values and presses enter. Values can be reordered via drag. Each value max 64 chars.

### Delete Behavior

- Confirmation modal warns that existing routes may still reference this label.
- Shows count of routes currently using this label key (fetched on modal open).
- On confirm, deletes the taxonomy entry. Routes keep their labels but they appear as "orphaned" in the routes page.

### i18n

All user-facing strings use i18n keys under the `labels.*` namespace. Keys added to all four locale files (en, es, de, zh).

## 4. Frontend — Routes Page Filter Bar

### Data Fetching Strategy

**Label filtering and grouping operate client-side on the full route dataset.** APISIX Admin API does not support multi-label OR/AND queries natively.

When label filters or grouping are active:
- Fetch all routes for the current instance via a single request with `page_size=0` (APISIX convention for "return all") or iterate pages sequentially
- Apply label filters client-side (OR within key, AND across keys)
- Apply grouping client-side on the filtered results
- Client-side pagination on the final result
- **Scalability threshold:** If the instance has more than 1000 routes, show a warning banner: "Large dataset — filtering may be slow." Above 5000 routes, disable client-side grouping and show a message suggesting server-side label filtering via APISIX's native `label` param (single-label only)

When no label filters or grouping are active:
- Use the existing server-side paginated fetch (current behavior, unchanged)

This hybrid approach avoids loading all routes when not needed, and only fetches the full set when the user actively uses label features.

**Cache:** Label taxonomy is fetched via TanStack Query with key `['labels', instanceId]`. Route list uses existing query key. Quick-add mutations call `queryClient.invalidateQueries({ queryKey: ['labels'] })` after success.

### Layout

New filter row between the existing search filters and the routes table.

### Components

1. **Dropdown per label key** — One Mantine `MultiSelect` dropdown for each defined label key (e.g., "Environment", "Team"). Dropdown pill shows the key's color as a left border indicator. Data options populated from taxonomy.

2. **Active filter chips** — Horizontal row below the dropdowns showing active filters. Each chip displays `key:value` with the key's color as background tint. Click `x` to dismiss. "Clear all" link appears when 2+ filters are active.

3. **Filter logic:**
   - Within same key: **OR** (e.g., `env:production OR env:staging`)
   - Across keys: **AND** (e.g., `env:production AND team:payments`)
   - Standard faceted search behavior.

4. **Integration with existing filters** — Label dropdowns sit alongside existing Name, Path, Status filters. All filters combine with AND logic. The existing label text input is replaced by the structured dropdowns.

5. **Empty state** — If no label keys are defined: admins see i18n `labels.empty.admin` ("No labels configured") with a link to `/labels` page. Non-admins see the label dropdowns hidden entirely.

### URL Search Params

Label filters are stored in URL search params: `?label_env=production,staging&label_team=payments`. The `pageSearchSchema` is extended with dynamic label filter params. Format: `label_{key}` = comma-separated values.

### Quick-Add (Admin Only)

- In each label dropdown, admins see a "+ Add value" option at the bottom.
- Clicking opens a small inline input to add a new value to that key.
- On submit, calls `PUT /api/v1/labels/{key}` with the updated values array.
- Invalidates `['labels']` query cache so all dropdowns refresh.
- On error (network failure, concurrent edit), show a Mantine notification toast with the error and revert the dropdown to its previous state.
- For adding entirely new keys, a link navigates to `/labels`.

## 5. Frontend — Grouped Table View

### Trigger

A "Group by" control in the routes table toolbar, next to the existing column visibility settings.

### Group-By Selector

- Cascading dropdown:
  - First level: select primary group key (e.g., "Environment") or "None".
  - When a primary key is selected, a second dropdown appears for secondary group key (e.g., "Team") or "None".
  - Maximum two levels of grouping.

### Grouped Table Rendering

- **Level 1 headers** — Full-width collapsible row with the key's color as left border accent (4px). Shows: `Environment: production (12 routes)`. Click to expand/collapse.
- **Level 2 headers** — Indented sub-headers within each L1 group with secondary key's color as left border. Shows: `Team: payments (4 routes)`. Also collapsible.
- **Routes** — Normal table rows nested under their group headers.
- **"Ungrouped" section** — Routes missing the group-by label key appear in an "Ungrouped" section at the bottom (collapsed by default, neutral gray border).

### Interactions

- "Expand all" / "Collapse all" toggle in the toolbar.
- Grouping works on already-filtered data (filters apply first, then grouping).
- Client-side pagination on the flat route list. Group headers are rendered inline with routes — they don't consume pagination slots. Each page shows N routes plus whatever group headers fall between them.

### State Persistence

Group-by selection stored in URL search params (`?groupBy=env,team`) to survive page refresh and enable sharing.

## 6. Frontend — Label Badges in Table

### Badge Styling

Each badge uses its label key's assigned color as background (light tint, Mantine `color.0` or `color.1` shade) with darker text (`color.8`). Format displays `value` only (key is implied by color). On hover, tooltip shows full `key: value`.

### Clickable Badges

Clicking a label badge in the table adds it as an active filter (equivalent to selecting it from the dropdown). Updates both the dropdown state and the active chips.

### Orphaned Labels

Labels on routes whose key has been deleted from the taxonomy display as grayed-out badges (`gray.2` background, `gray.6` text) with a dashed border. Tooltip: i18n `labels.orphaned.tooltip` ("This label is no longer managed").

### Overflow

If a route has 3+ labels, show the first 2 and a `+N` badge. Click `+N` to expand inline.

## 7. Route Create/Edit Form

### Changes to FormItemLabels

The existing `FormItemLabels` component (`src/components/form/Labels.tsx`) is used by `FormPartBasic`, which is shared across routes, services, and other resource forms.

**Approach:** Conditionally render based on resource type.
- **For routes:** Replace the free-text TagsInput with structured label selection — one dropdown per defined label key. Developer selects from allowed values (one value per key per route). Admin sees the quick-add option for new values. Existing routes with orphaned labels show them as grayed-out chips with option to remove.
- **For other resources (services, upstreams, etc.):** Keep the existing free-text TagsInput behavior unchanged.

`FormPartBasic` passes a `resourceType` prop (or uses route context) to `FormItemLabels` to determine which mode to render.
