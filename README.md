# Esper DataTap Reporting

A reporting and dashboard application for Esper DataTap. Build reports without writing SQL, visualize device data, and combine saved reports into dashboards. Run locally with sample data or connect an Esper tenant for live DataTap queries.

Built with React, TypeScript, Vite, Express, Recharts, and Dexie/IndexedDB.

## Quick start

Requires **Node.js 22.16 or newer** and npm.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000).

Development starts in a local demo workspace with no login or API key required. Sample data contains 30 daily snapshots and 1,284 devices in the latest snapshot. Saved reports, visualizations, and dashboards persist in `.data/demo.json`; sample source records regenerate on server startup.

The demo workspace bypasses authentication. Keep it local; use authenticated configuration for a shared deployment.

## Features

- Explore Devices, Device Statistics, Applications, Groups, and Users.
- Build detail or summary reports with selected columns, display labels, typed filters, grouping, aggregates, sorting, and row limits.
- Query the latest snapshot, a specific snapshot, or a historical date range.
- Join Devices to Groups, matching snapshot dates for historical queries.
- Create tables, bar charts, line/area charts, pie/donut charts, and KPIs.
- Save, duplicate, edit, and organize reports, visualizations, and dashboards.
- Rearrange and resize dashboard widgets.
- Export result tables as CSV and chart plots as PNG.
- Inspect generated SQL without accepting arbitrary SQL from the browser.
- Reuse results through browser and server caches, with freshness indicators and quota-aware refreshes.
- Enforce viewer, analyst, and administrator roles in authenticated mode.

Open a report to load its results. After editing its fields or filters, select **Run report** to apply changes. Previews are capped at 100 rows; full executions are capped at 10,000. Explicit refreshes still respect DataTap quotas.

## Connect to DataTap

### Through the application

1. Open **Connection settings** as an administrator.
2. Enter the Esper tenant slug, such as `acme`, and its API key.
3. Use **Test connection** to verify access, or **Save & use live data** to verify and activate it.

The endpoint is derived as:

```text
https://{tenant}-api.esper.cloud/api/data-tap/v0
```

Connection tests run a bounded device query and consume DataTap requests. Failed tests preserve the previous connection. Leaving the API-key field blank retains the current key only when the tenant is unchanged.

Saved connections override environment credentials for the application workspace. **Disconnect** removes the saved credential and disables environment fallback. Local workspaces return to sample data; authenticated workspaces remain unconfigured until reconnected. Connection changes invalidate cached results while preserving saved report definitions.

Credentials stay on the server. Saved keys are encrypted with AES-256-GCM in `.data/connections.json`, using `.data/connection.key`. Both files have owner-only permissions. Back them up together and never commit them. Redirects are disabled on credential-bearing DataTap requests.

### Authenticated configuration

Copy `.env.example` to `.env` and configure authentication:

```sh
cp .env.example .env
npm run hash-password
```

The password utility accepts hidden input and prints a salted scrypt hash. Generate a session secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Example `.env` values:

```dotenv
DEMO_MODE=false
PORT=3000
SESSION_SECRET=<at least 32 random characters>
REPORTING_USERS=[{"id":"user-1","name":"Your Name","email":"you@example.com","passwordHash":"scrypt:<salt>:<hash>","tenant":"workspace-1","role":"administrator"}]
```

The `tenant` on a user is the application workspace identifier. Sign in and configure its Esper connection through Connection settings, or supply server-side credentials:

```dotenv
DATATAP_BASE_URL=https://acme-api.esper.cloud/api/data-tap/v0
DATATAP_API_KEY=<server-side API key>
```

For multiple workspaces, use an explicit credential map:

```dotenv
DATATAP_TENANTS={"workspace-1":{"baseUrl":"https://acme-api.esper.cloud/api/data-tap/v0","apiKey":"<key>"}}
```

The global key is accepted only when all configured users belong to the requesting workspace. Each upstream credential must have appropriate Esper tenant permissions. `.env` and `.data/` are ignored by Git.

## Caching and request limits

The application caches query results, rather than separate copies for each visualization. Identical concurrent queries share one upstream job. Cache keys distinguish users, workspaces, connection revisions, query semantics, preview/full mode, and live/demo data.

| Result scope | Fresh lifetime | Maximum stale age |
|---|---:|---:|
| Latest Devices, Applications, Groups, Users | 10 minutes | 60 minutes |
| Latest Device Statistics | 5 minutes | 30 minutes |
| Past snapshot or entirely historical range | 24 hours | 7 days |

Eligible stale results remain visible while refreshing. Failed refreshes retain eligible results with an explanation; hard-expired results are hidden. Cache hits retain the original fetch time. Historical snapshots are not assumed immutable.

- **Browser memory:** up to 50 entries / 30 MiB.
- **IndexedDB:** eligible results, with an 80 MiB target within a 100 MiB budget; authorized catalog metadata lasts 12 hours.
- **Server:** up to 100 MiB overall / 25 MiB per authorization namespace.
- Results over 10 MiB are not cached. Browser-storage failures fall back to memory/server behavior.
- Sensitive detail fields default to memory-only browser storage. Credentials are never cached in the browser.

Configuration:

| Variable | Default | Purpose |
|---|---|---|
| `DATATAP_REQUESTS_PER_HOUR` | `25` | Positive rolling request budget per DataTap endpoint; includes submissions, polls, and connection tests |
| `BROWSER_CACHE_SENSITIVE` | Unset/false | Set to `true` only when organizational policy permits sensitive browser persistence |
| `DATA_DIR` | `.data` | Server definition, credential, and request-budget storage directory |

The server serializes upstream jobs per endpoint and persists budget accounting in `.data/request-budget.json`. A 429 response establishes a shared cooldown. When DataTap provides no reset time, the server uses a conservative one-hour local estimate. Other clients may also consume the tenant quota.

Use **Clear cached results** in the sidebar to remove local results and metadata without deleting saved reports. Server restarts invalidate result namespaces; the request-budget ledger and saved definitions survive.

See [caching implementation](docs/caching-implementation.md) for API contracts, recovery behavior, privacy rules, and deployment limits, and [cache design](specs/datatap-reporting-cache-design.md) for the broader design.

## Data semantics

DataTap reports daily snapshots. Fetching fresh results does not mean each device just reported its current state.

**Status at Snapshot** is derived from `last_seen` relative to `report_generation_timestamp`:

- Online: within 30 minutes.
- Idle: more than 30 minutes, up to 24 hours.
- Offline: more than 24 hours.
- Unknown: missing or invalid timestamps.

The physical `devices.state` field describes provisioning, not connectivity.

Device Statistics exposes individual memory, battery, network, and location fields extracted from JSON. Missing values remain empty; numeric extraction preserves real zeroes. Values with unverified units are not silently converted. Raw JSON remains compatible with older saved reports but is hidden from new field selections.

Some fields are not provided by their live tables: Devices battery, Device Statistics CPU usage, Groups region, and Users display name. They are explicitly labeled unavailable. Use Device Statistics for battery data. Live filters and summaries over unsupported fields fail with a specific explanation rather than producing misleading totals.

Schema and availability vary by tenant and snapshot. Catalog mappings are defined in `server/catalog.mjs` and `server/live-fields.mjs`. Tenant-specific validation reports are kept local and excluded from Git.

## Development commands

| Command | Action |
|---|---|
| `npm run dev` | Start the local API and Vite development frontend |
| `npm run check` | TypeScript check |
| `npm test` | Run automated tests with temporary stores, mocked DataTap, and fake IndexedDB |
| `npm run build` | TypeScript check and optimized frontend build |
| `npm start` | Serve the built frontend and API in production mode |
| `npm run format` | Format source and tests |
| `npm run hash-password` | Generate a password hash for configured users |

Tests cover query validation, schema mappings, authentication/isolation, DataTap responses, result reuse, deduplication, invalidation, IndexedDB failures, quota accounting, and upstream query recovery. They do not call live DataTap or modify the application's saved workspace. HTTP integration tests need free local ports 3137, 3139, and 3142.

For a local preview of the production bundle:

```sh
npm run build
DEMO_MODE=true npm start
```

This preview still bypasses authentication. Do not expose it as a shared production service.

## Project layout

```text
src/                  React application, report builder, dashboards, charts
  api.ts              API execution, browser caching and refresh coordination
  result-cache.ts     Memory and Dexie/IndexedDB storage
  cache-status.tsx    Freshness indicators and invalidation handling
server/
  index.mjs           Authentication, CRUD, execution lifecycle and cache integration
  catalog.mjs         Allowlisted datasets, fields and operators
  query.mjs           Query validation, SQL compilation and demo evaluation
  datatap.mjs         DataTap submission, polling, normalization and recovery
  result-cache.mjs    Server cache identity, policy and bounded storage
  request-budget.mjs  Persistent quota accounting and upstream scheduling
  statistics-fields.mjs  Allowlisted JSON projections
shared/               Shared cache canonicalization and label helpers
tests/                Regression and integration tests
specs/                Product requirements, design, story map and cache design
docs/                 Field audits and implementation notes
public/               Static assets, including the Esper wordmark
.data/                Private runtime data; not committed
```

## Deployment and limitations

The current application is designed for **one server process**. Saved definitions use atomic JSON-file replacement. Use a backed-up persistent volume; replace the definition store with a transactional database and add shared cache/lease/budget coordination before introducing replicas.

The server binds to loopback. A shared deployment needs a same-origin HTTPS reverse proxy, correctly configured proxy trust, authenticated mode, secure cookies, and deployment-managed secrets. Encryption-key and credential files must remain private.

Results and upstream job IDs are held in server memory. Known upstream IDs can be resumed after transient failures within the process, but jobs do not survive a server restart. There is no durable worker queue or offline reopening of analytics without authorization.

Deferred features include SSO, scheduled delivery, execution-history UI, relative-date presets, nested filter groups, dashboard-wide filters, arbitrary relationship editing, local draft recovery, shared/public links, and dashboard PDF export. Stacked charts stack multiple metrics rather than pivoting a second dimension into series.

## Troubleshooting

| Symptom | Check |
|---|---|
| All reports fail with a request-limit message | Wait for the quota/cooldown, or confirm the tenant's allowance before changing the configured budget. Repeated connection tests also consume requests. |
| Unable to reach DataTap | Check the tenant slug and derived hostname. The tenant entry must not include a URL or an extra suffix. |
| API key rejected | Verify the tenant, key, and DataTap permissions. A key must be supplied when changing tenants. |
| Empty or unavailable fields | Check the field description and source-data availability; empty values are not automatically zero. |
| Cached results look old | Check fetch age and snapshot date, then refresh. Refresh still obeys quota and deduplication. |
| Browser storage unavailable | Reports continue through memory and the server cache; persistent browser caching is optional. |
| Production startup fails | Build first, disable demo mode, and configure a session secret and authenticated users. |

## Documentation

- [Product requirements](specs/datatap-reporting-prd.md)
- [Design specification](specs/datatap-reporting-design-spec.md)
- [Story map](specs/datatap-reporting-story-map.md)
- [Caching design](specs/datatap-reporting-cache-design.md)
- [Caching implementation](docs/caching-implementation.md)

The Esper wordmark in `public/esper-logo.svg` was sourced from [esper.io](https://www.esper.io/).
