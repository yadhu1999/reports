# Caching implementation

Implemented September 14, 2026 for the current single-process application. The broader [cache design](../specs/datatap-reporting-cache-design.md) remains the reference for deployment extensions.

## Behavior

- Report and dashboard queries use a SHA-256 key derived from validated query semantics, preview/full mode, and an opaque namespace covering application tenant, user, role, live/demo mode, DataTap endpoint/connection revision, catalog version, and server boot revision. Keys never contain credentials. Labels and visualization styling do not create new data entries; labels are reapplied per caller.
- Fresh results are reused in browser memory, eligible IndexedDB storage through Dexie, or the server cache. Concurrent identical computations share one upstream job. Execution handles remain per caller and are checked against current user and namespace.
- Latest results stay fresh for 10 minutes, Device Statistics for 5 minutes, and explicit past snapshots/ranges for 24 hours (UTC date boundary). Maximum stale ages are 60 minutes, 30 minutes, and 7 days respectively. Historical results are not immutable. True empty results, warnings and row-limit flags are preserved.
- Stale results render while one refresh proceeds. Refresh failures retain eligible stale data with an explanation. Hard-expired results are hidden from tables/charts/KPIs and cannot be exported as current results. Original fetch times do not advance on cache hits; browser age checks use a server-time anchor and a monotonic clock.
- Reports, dashboard widgets and the data explorer share the browser request/cache layer. Explicit refresh bypasses freshness but not deduplication or quota. Editing a report waits for Run before submitting the changed query. A changed definition may reuse an existing result; running an unchanged definition requests revalidation.
- Authorized catalog metadata is stored in IndexedDB for 12 hours. Every persisted read first establishes current authorization and namespace with the server. There is no offline reopening without authorization.
- Clear cached results in the sidebar removes local results and metadata without deleting saved reports. Logout/login, connection changes and cross-tab invalidation clear local entries and remove results from view. Tab focus revalidates before redisplaying cached results.

## Storage and security

Memory: 50 entries / 30 MiB. IndexedDB result storage targets 80 MiB within a 100 MiB budget and evicts expired/least-recently-used entries. A result larger than 10 MiB is not cached. The server cache is limited to 100 MiB overall and 25 MiB per authorization namespace. Storage failures degrade to memory/server behavior rather than failing the report.

Users data, raw statistics JSON and identifying/location fields default to memory-only browser storage. Count-only summaries can be persisted when their output, grouping and filters do not reveal those fields. `BROWSER_CACHE_SENSITIVE=true` explicitly permits persistence of sensitive fields for a trusted deployment; leave it unset by default. Credentials never enter the result cache or IndexedDB. Browser storage remains accessible to code on the app origin.

Server results and recoverable upstream query IDs are in memory, so a server restart invalidates browser namespaces and empties server results. The request-budget ledger is persisted separately in `.data/request-budget.json` with restrictive permissions and survives restarts. Cache state is disposable; saved definitions remain in the existing server store. No localStorage analytics cache or service worker was added.

## DataTap quota protection

`DATATAP_REQUESTS_PER_HOUR` is a positive per-endpoint rolling budget, default 25. It counts all calls made by this server, including submissions, polls and connection verification. Other clients may consume the upstream tenant quota, so local accounting cannot guarantee availability.

One upstream query runs at a time per endpoint, with a maximum of 20 queued jobs. A queued job defers if it has waited two minutes. At least two call slots are required for a new submission; resuming a known job requires one. Poll intervals are 10, 20, then 30 seconds, with a 120-second upstream execution window. The browser allows 270 seconds for bounded queueing plus execution.

429 responses establish a shared cooldown, honoring numeric or HTTP-date Retry-After. Without a supplied reset time, the server uses a conservative local one-hour cooldown. Budget/queue deferrals return clear errors rather than generating retry storms. A known query ID is retained after timeout, quota, or transient polling failure and reused on retry without another POST. An uncertain submission with no known ID is not automatically retried. Upstream authorization errors invalidate the connection's cache namespace.

## API additions

- `GET /api/cache/context`: authorized namespace and server time for metadata reads.
- `POST /api/cache/prepare`: accepts `{query, preview}`; validates it and returns authoritative namespace, key, policy, and server time. Does not contact DataTap.
- `DELETE /api/cache`: clears the caller's server partition and advances the workspace namespace revision. Local sidebar clearing uses browser storage only.
- `X-Report-Cache-Intent: default | revalidate` on execution endpoints.
- Completed results include additive `cache` metadata. A stale/refreshing response has a separate `refresh_execution_id` to poll. Audit events record the cache source without row values.

## Implementation files and validation

- `shared/cache-identity.mjs`: canonical query serialization and presentation relabeling.
- `server/result-cache.mjs`: identity, privacy/freshness policy and bounded result storage.
- `server/request-budget.mjs`: persisted quota accounting and query serialization.
- `server/index.mjs`, `server/datatap.mjs`: authorized result reuse, shared work, resume IDs and rate-limit handling.
- `src/result-cache.ts`, `src/api.ts`: Dexie/memory/metadata caching, authorization gates, shared requests and stale refresh.
- `src/cache-status.tsx`: freshness/expiry indicators and invalidation/focus handling.

All 56 tests and the production build pass. Added checks cover counted upstream deduplication, changed connection namespaces, current labels, manual refresh, numeric canonicalization, empty results, LRU expiry, sensitive-field policy, IndexedDB failure/isolation, persistent cooldown, and GET-only resumption of known jobs. Tests use fake upstream responses and fake-indexeddb; no live DataTap requests were used for cache testing.

## Deployment extensions

Redis/distributed leases and shared multi-replica quotas are not included; keep one server process. Server cache entries are intentionally per user, not shared across users with supposedly equivalent permissions. Organization-specific field policies are currently conservative code plus the explicit sensitive-persistence flag, rather than an administrator policy editor. Configurable TTL/storage limits, snapshot ingestion invalidation hooks, offline authorization, local draft recovery/conflict UI, and Web Locks coordination are separate extensions. Cross-tab notifications are implemented and mandatory upstream deduplication is server-side.
