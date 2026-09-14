# Esper DataTap Reporting

A runnable implementation of the reporting MVP described in `specs/`. React + TypeScript provides the visual workspace; an Express API owns metadata, validation, SQL compilation, asynchronous execution, credentials, and durable saved definitions.

## Run locally

Requires Node.js 22.16 or newer and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:3000**. Development defaults to a clearly labeled demo workspace. It generates 30 daily snapshots across the five specified datasets, with 1,284 devices in the latest snapshot. No DataTap account is required. Saved objects live in `.data/demo.json` and survive restarts. Sample source records are regenerated relative to the current date on server start.

```sh
npm run build   # TypeScript check and optimized frontend bundle
npm test        # Query engine, adapter, and authenticated HTTP integration tests
npm run format  # Format source and tests
```

`npm start` serves the compiled frontend and API. Production requires explicit authentication configuration. For a local production-bundle demo, run `DEMO_MODE=true npm start`; this intentionally bypasses authentication and must not be exposed as a production service.

## Included workflows

- Fleet dashboard with independently loading KPI, bar, donut, and table widgets.
- Reporting overview, searchable/filterable report list, visualization library, dashboard cards and favorites.
- Metadata-backed exploration of Devices, Device Statistics, Applications, Groups, and Users, including data and schema tabs.
- Visual report builder with field search, selected-column drag and keyboard ordering, display labels, typed filters, multiple sorts, row limits, and detail/summary modes.
- COUNT, COUNT DISTINCT, SUM, AVG, MIN, MAX, with type validation; multiple dimensions and metrics.
- Latest snapshot, specific snapshot, historical date ranges, and snapshot-aware Devices → Groups relationships.
- Table, vertical/horizontal/stacked bar, line, area, pie, donut, and KPI rendering with compatibility checks and display options.
- Separate saved report and visualization definitions; create, edit, duplicate, delete, and reopen.
- Dashboards that reference saved definitions, with add/remove/duplicate, drag rearrangement, keyboard ordering, and pointer/keyboard resizing. Save commits the layout; Cancel restores it.
- CSV export of the currently executed result, with spreadsheet-formula protection. Use **Run report** for up to 10,000 rows; automatic previews are limited to 100.
- PNG export of chart plots, read-only generated SQL inspection, loading/empty/error/retry states.
- Server-side sessions, viewer/analyst/administrator role checks, tenant-scoped resources and executions, request-origin checks, login throttling, and audit events.

## Connect live DataTap

### Configure in the app

Open **Connection settings** in the sidebar as an administrator. Enter your Esper tenant slug (for example, `acme` from `acme.esper.cloud`) and API key. **Test connection** checks DataTap access without changing the active source. **Save & use live data** verifies the connection and activates it immediately, including in the local sample workspace. Failed tests preserve the previous connection. Blank API-key input retains an existing key only when the tenant is unchanged.

The server derives `https://{tenant}-api.esper.cloud/api/data-tap/v0` and tests a bounded device query before saving. Keys are encrypted using AES-256-GCM in `.data/connections.json`; the server encryption key is `.data/connection.key`. Both files have owner-only permissions. Back up both together, keep the directory private, and never commit either. API responses and audit records do not contain saved credentials. Redirects are disabled on credential-bearing DataTap requests.

Connection settings are scoped to the authenticated application workspace. They override environment configuration for that workspace. **Disconnect** removes the saved credential and disables any environment fallback; local workspaces return to sample data, while authenticated production workspaces remain unconfigured until reconnected. Changing connections clears previous execution results. Report definitions remain available.

The local demo workspace intentionally has no login and is bound to loopback; its settings are accessible to local users. Use the authenticated production configuration below for a shared deployment.

### Environment configuration

Copy `.env.example` to `.env`, set `DEMO_MODE=false`, and provide a secret and users. `.env` is ignored by Git and loaded only by the server.

```dotenv
DEMO_MODE=false
PORT=3000
SESSION_SECRET=<at least 32 random characters>
REPORTING_USERS=[{"id":"user-1","name":"Your Name","email":"you@example.com","passwordHash":"scrypt:<salt>:<hash>","tenant":"your-tenant","role":"administrator"}]
DATATAP_BASE_URL=https://develop-api.esper.cloud/api/data-tap/v0
DATATAP_API_KEY=<your server-side token>
```

Generate a session secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Generate a password hash with `npm run hash-password`; password entry is hidden. The script prints a salted scrypt hash for the user configuration, never the plaintext password.

For multiple tenants, set `DATATAP_TENANTS` to a JSON map of tenant IDs to `{ "baseUrl": "https://...", "apiKey": "..." }`. The single global key is accepted only when all configured users belong to the requesting tenant. Each configured credential must itself be restricted to its tenant by Esper. Do not give two unrelated tenants the same unrestricted upstream credential.

The adapter implements the contract supplied in the specs:

1. `POST /queries/` with `{ query, latest_data }` and a backend-only Bearer token.
2. Read `content.id` and `content.status`, then poll `GET /queries/{id}`. Top-level response envelopes are also supported.
3. Normalize `content.result.data_array` against the semantic output columns, converting numeric results.
4. Stop on success, failure, cancellation, or the 60-second deadline.

**Live connectivity verified on September 10, 2026:** bounded device and Devices → Groups queries completed successfully using user-supplied credentials. DataTap returns ID, status, and results under `content`. The compiler uses strictly validated bare identifiers, because ANSI double-quoted identifiers failed on the live endpoint. The tenant hostname and Bearer authorization follow [Esper’s API guide](https://help.esper.io/hc/en-us/articles/14199291792145-Getting-Started-with-APIs). Sample-only schema assumptions (such as battery and model fields) still need validation for each tenant; they are centralized in `server/catalog.mjs` and the demo module.

## Deployment boundaries

This is a single-process, locally runnable MVP, not a completed enterprise deployment. The backend binds to loopback. Put it behind a same-origin HTTPS reverse proxy when deploying; production cookies are Secure and HttpOnly. Configure Express proxy trust narrowly if the proxy terminates TLS so origin validation sees the actual request protocol. Store runtime secrets in your deployment's secret manager rather than committed files.

The definition store uses synchronous atomic JSON-file replacement and keeps a bounded audit history. Use a backed-up persistent volume for one server instance. Replace this store with a transactional database before running multiple writers/replicas. Execution results are transient and expire after an hour; API query jobs do not survive a server restart; known upstream IDs can be resumed after transient failures within the running process. There is no durable worker queue, SSO integration, password-reset UI, shared-public links, external embedding, or live fleet streaming.

Relative-date presets, nested AND/OR groups, arbitrary relationship editing, category/series pivoting, dashboard-wide filters, scheduled delivery, execution-history UI, folder management, and comparison-period KPI trends are deferred. Stacked charts currently stack multiple metrics; they do not pivot a second dimension into series. PNG export exports the chart plot; dashboard PDF export is not included.

Caching is implemented for this single-process app: memory + policy-controlled IndexedDB/Dexie, server result reuse and query deduplication, stale refresh with age indicators, and a persisted DataTap request budget. See [implementation and configuration](docs/caching-implementation.md) and the [design](specs/datatap-reporting-cache-design.md). Defaults are 10-minute latest-data TTLs, 5 minutes for statistics, and 24 hours for past snapshots. `DATATAP_REQUESTS_PER_HOUR` defaults to 25; sensitive browser persistence is disabled unless `BROWSER_CACHE_SENSITIVE=true`. Server restarts invalidate result namespaces; saved reports remain intact.

No hosting deployment was performed. The source project and running local preview are the deliverables.

## Architecture

- `src/App.tsx`: application shell, navigation, object lists, session and object actions.
- `src/ReportBuilder.tsx`: declarative configuration, previews, visualization selection, save and export flows.
- `src/DashboardView.tsx`: responsive editable dashboard and independent widget execution.
- `src/Explorer.tsx`, `src/components.tsx`: metadata browser, tables, charts, accessible native dialogs.
- `server/catalog.mjs`: allowlisted semantic metadata, relationships, filter and aggregation capabilities.
- `server/query.mjs`: validation, SQL generation, normalized columns, and sample-data evaluation.
- `server/datatap.mjs`: bounded server-only submit/poll/normalize adapter.
- `server/index.mjs`: authenticated/tenant-scoped APIs, persistence, audit and execution lifecycle.
- `tests/`: query semantics, SQL safety, mocked DataTap contract, and authenticated API integration checks.

All primary REST routes from the specs are implemented. `/api/reporting/query/compile` additionally provides the read-only query inspector, and `/api/session`, `/api/login`, `/api/logout` handle application sessions. Audit records are available to administrators at `/api/audit-events`.

A feature-detected browser WebMCP tool opens existing saved reports through the same application state. It is optional; normal browsers need no WebMCP support. Registration was not validated in a WebMCP-capable browser.

## Verification

The test suite covers snapshot selection, historical join dates, aggregates and nulls, filter escaping and type compatibility, rejected identifiers/raw SQL, limit enforcement, sorting, DataTap polling/normalization/timeouts, login, roles, cross-origin mutation rejection, tenant isolation, reference integrity, and persistence after restart. Tests use a temporary server on port 3137 and a temporary store; they do not alter the demo workspace or call a real DataTap service.

Frontend verification consists of TypeScript checking and a production build. A local HTTP readiness check confirms serving. Browser interaction/visual testing has not been performed.

## Brand asset

`public/esper-logo.svg` is the official navigation wordmark downloaded from [esper.io](https://www.esper.io/), [original SVG](https://cdn.prod.website-files.com/68dc0aa637f28f93a0bbbb71/68ec7835a472683506853583_Group%201.svg). The original white asset is used on the sidebar; a CSS monochrome filter makes it visible on light login/loading surfaces.

## Online/offline reports

The live `devices` table does not contain a physical `status` column. Its `state` field describes provisioning. The semantic **Status at Snapshot** field is derived from `TRY_CAST(last_seen AS TIMESTAMP)` relative to `report_generation_timestamp`:

- Online: last seen within 30 minutes of the snapshot.
- Idle: more than 30 minutes, up to 24 hours.
- Offline: more than 24 hours.
- Unknown: missing or invalid last-seen/snapshot timestamps.

This describes the daily snapshot, not current live connectivity. The intervals follow [Esper's last-seen status panels](https://help.esper.io/hc/en-us/articles/12591504254225-Dashboard-Components). The same derivation is used by the SQL compiler and sample-data evaluator. Online/offline queries were verified against live DataTap. The original seeded offline inventory is migrated to verified device/group fields without overwriting customized column selections.
