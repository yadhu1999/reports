# DataTap reporting cache design

Status: initial single-process cache implemented September 14, 2026. See [implementation status and limits](../docs/caching-implementation.md). This document retains the full design target, including separately identified production/deployment extensions.

## 1. Purpose and boundaries

Make repeated report/dashboard reads fast and reduce DataTap requests while keeping tenant isolation, permissions, snapshot meaning, and missing-data warnings intact. Cache the underlying query result once and reuse it for tables, charts, and KPIs. Saved report and visualization definitions remain authoritative on the server.

Initial implementation now includes memory/IndexedDB result caching, metadata caching, authorized server reuse, single-flight execution, persisted quota accounting, refresh UI and recovery of known upstream IDs within a process. HTTP no-store remains enabled. Redis, draft recovery and offline authorization remain separate extensions; the implementation document specifies exact current behavior.

Use a conservative initial request budget of 25 requests per hour, adjustable to the tenant’s allowance. Do not assume every tenant has this limit or that only query submissions count. TTL alone cannot keep a dashboard within a small request budget.

## 2. Storage layers

| Layer | Contents | Lifetime and ownership |
|---|---|---|
| Browser memory | Current/recent normalized query results, pending requests | Session-bound LRU; 30 MiB or 50 entries, whichever is reached first |
| IndexedDB, with Dexie as the proposed wrapper | Eligible results, authorized catalog metadata, local drafts | Disposable cache; server policy controls eligibility and expiry |
| localStorage | Small presentation preferences: theme, density, last selected dashboard | Maximum 32 KiB; namespace user/workspace-specific preferences; no results or credentials |
| Reporting server cache | Authorized normalized results and in-flight query registry | Bounded in-process implementation initially; shared Redis adapter before multiple server replicas |
| Cache API | Optional versioned static application assets | Not the analytics store; never indiscriminately cache /api responses |

Memory residency does not establish freshness: moving an entry between layers never extends its source expiry. Keep existing HTTP no-store headers; deliberate IndexedDB writes require explicit cache policy. Static offline support and a service worker are separate work.

Proposed IndexedDB stores:

- queryResults: compound primary key [namespace, key]; indexes [namespace, lastAccessedAt], [namespace, expiresAt], [namespace, staleUntil], dataset.
- metadata: [namespace, key], expiresAt, catalogVersion.
- drafts: [namespace, resourceId], baseRevision, updatedAt. A draft is an unsaved edit, not a second server record.

Never create three cache entries for three chart types over the same result. Exports use the displayed result and disclose its execution/snapshot time and truncation state.

## 3. Identity and deterministic keys

The server authenticates and validates the definition before cache lookup. It provides an opaque namespace in the authenticated bootstrap response containing the effects of:

- Application workspace/tenant and actual DataTap tenant/endpoint identity.
- Server-generated connection revision, changed on key replacement, connect, disconnect, or endpoint change.
- Authorization scope revision and effective row/data permissions. Default to per-user server partitions; cross-user sharing is permitted only when the server proves identical data entitlements.
- Live versus demo mode, catalog/compiler version, and result-format version.

Never include an API key, token, or a hash of a secret in browser keys. A namespace is an identifier, not authorization. It cannot grant access to an execution or cache entry.

Calculate:

```
key = SHA256(canonicalJSON({
  namespace,
  source,
  columns,
  filters,
  metrics: [{ field, aggregation, alias }],
  group_by,
  sort,
  related,
  data_scope,
  effective_limit,
  execution_mode: "preview" | "full"
}))
```

Canonicalization rules:

1. Apply the same validation/defaults and effective row caps as the compiler before hashing. Retain only allowlisted query properties.
2. Sort object keys recursively; retain array order, including selected columns, sort priorities, group keys, metrics, joins and filters. Do not reorder arrays merely to increase hits.
3. Normalize validated numeric filter values as numbers and dates as YYYY-MM-DD. Preserve case and whitespace of string filter values. Reject invalid values rather than normalizing them into valid-looking values.
4. Keep preview/full distinct even if their limits happen to match. Include the full date range or snapshot date; future relative dates must first resolve to absolute boundaries and timezone.
5. Exclude report ID/name, descriptions, favorites, visualization settings, column display labels and metric display labels. Reapply current labels after retrieving canonical columns; never reuse another report's presentation labels.
6. Include metric aliases because they determine returned column IDs. Include mapping/compiler versions so JSON-path and connectivity-rule fixes invalidate older results.

The server key is authoritative. Ship a shared canonicalizer for browser lookups; on a key/version mismatch discard the local lookup and use the server result. Report edits create a new key only when execution semantics change. A latest query keeps its latest-scope key; a historical query for the same date is a different request.

## 4. Result entry and response contract

Store canonical columns/rows, warnings, truncation/limit flags and origin timestamps, not browser components or transport execution objects. An entry includes:

```
namespace, key, source, normalizedDefinition, result,
fetchedAt, expiresAt, staleUntil, lastAccessedAt, sizeBytes,
snapshotRange: { from, to } | null,
catalogVersion, resultFormatVersion
```

Use UTC ISO timestamps on the wire; indexed local time values may be epoch milliseconds. Define freshness using server time supplied with policy; handle browser clock skew using the most recent server-time offset. Never reset fetchedAt on a cache hit. Snapshot dates are the dates in the source data, not the query execution date. If they are not returned/verified, use null; do not infer them from today's date. Do not submit extra DataTap queries solely to fill cache metadata.

Preserve the existing asynchronous endpoints and terminal status `complete`. Add an optional `X-Report-Cache-Intent: default | revalidate` request header, validated by the server and excluded from the query key. Refresh intent does not grant authorization or bypass quota. Every caller gets an authorized execution handle; multiple handles may observe one shared in-flight computation. Cache hits can immediately yield a completed execution. Proposed additive terminal response:

```json
{
  "execution_id": "exec_example",
  "status": "complete",
  "columns": [],
  "rows": [],
  "metadata": {
    "row_count": 0,
    "executed_at": "2026-09-14T19:00:00Z",
    "mode": "live",
    "warnings": [],
    "truncated": false,
    "limit_reached": false
  },
  "cache": {
    "namespace": "opaque-scope-revision",
    "key": "sha256-canonical-query",
    "source": "server",
    "state": "fresh",
    "server_time": "2026-09-14T19:00:01Z",
    "fetched_at": "2026-09-14T19:00:00Z",
    "expires_at": "2026-09-14T19:10:00Z",
    "stale_until": "2026-09-14T20:00:00Z",
    "ttl_seconds": 600,
    "immutable": false,
    "browser_cache_allowed": true,
    "persist_allowed": true,
    "snapshot_range": null,
    "refresh_execution_id": null,
    "retry_not_before": null
  }
}
```

Stale responses may reference a separate authorized refresh execution. Poll that refresh handle; do not treat a stale completed result as if it will mutate in place. Cache source is upstream/server/memory/indexeddb, and state is fresh/stale. Hard-expired entries are misses. Browser-added source labels cannot override server eligibility or timestamps. A browser cache disallow policy also disables memory reuse after the active rendering operation.

## 5. Initial freshness policy

These defaults are adjustable by server-side dataset policy, not arbitrary client TTLs. For joins, use the shortest applicable freshness duration. Stale windows below are maximum ages measured from the original fetch, not additional time after expiry.

| Scope/data | Fresh TTL | Maximum age for stale display |
|---|---:|---:|
| Latest Devices, Applications, Groups, Users | 10 minutes | 60 minutes |
| Latest Device Statistics | 5 minutes | 30 minutes |
| Explicit snapshot strictly before today's date in the configured reporting timezone | 24 hours | 7 days |
| Date range entirely before today | 24 hours | 7 days |
| Snapshot/range including today or a future date | Dataset latest TTL | Dataset latest stale window |
| Authorized catalog metadata | 12 hours | None across catalog/authorization revision changes |

Historical snapshots can be corrected or backfilled. Default immutable=false, even for historical data; do not cache indefinitely without an explicit upstream finality/version guarantee. DataTap is snapshot reporting: a fresh cache means recently fetched, not necessarily recently reported by the device.

## 6. Lookup and refresh algorithm

```
load(query, intent = "open"):
  establish authenticated session, namespace and current server policy
  normalize query and calculate key
  candidate = memory.get(namespace, key)
  if missing and persistence allowed: candidate = indexedDB.get(namespace, key)
  reject candidate on namespace/version/policy mismatch or hard expiry
  if candidate exists:
    reapply current labels; display result with origin age and cache state
    if fresh and intent != "refresh": return
  join local inFlight[key] if present
  request reporting API once using default or revalidate cache intent
  server authenticates, validates, derives its own namespace/key:
    if fresh server entry and default intent: return authorized completed handle
    if stale allowed: return stale handle plus refresh handle or retry_not_before
    join server single-flight entry or enqueue one refresh under tenant budget
    on upstream success: validate result; atomically replace cache entry
    on failure: retain eligible stale entry without extending expiry
  on successful refresh:
    accept only if namespace, key, and request generation still match current view
    populate memory and eligible IndexedDB entry; update all subscribers
  always release local inFlight membership
```

Do not contact DataTap when both local and server results are fresh. Looking up a stale browser entry can still find a fresh server result. Cache a legitimate successful empty result; do not cache a failure as an empty table. Never publish partially polled results. Preserve the latest known good result after refresh failure, visibly marked stale, until its staleUntil deadline.

Within a dashboard, deduplicate identical effective query definitions before submitting. Use a per-key Promise/subscription registry in one tab and BroadcastChannel notifications plus Web Locks when available across tabs. These are optimizations; server-side deduplication is mandatory when browser coordination is unavailable. One widget unmount must not cancel work still needed by another widget. Drop late responses after connection changes, logout, query edits or newer refresh generations.

Explicit Refresh bypasses freshness eligibility, not authentication, single-flight work or rate limits. Refreshing a dashboard schedules each unique key once. No timer-based background refresh for hidden tabs, closed dashboards or unsaved editor keystrokes. Visible stale results trigger at most one attempt per key/cooldown; focus events are coalesced.

## 7. DataTap budget and failure handling

All upstream submissions, polls and connection tests share a server-side per-connection scheduler. Configure limits per tenant. Initially model a conservative rolling budget of 25 total HTTP requests/hour until the service contract confirms which calls count. Record all outgoing calls; do not count browser polling of our own API against this budget.

- Initial upstream concurrency: one query per tenant. Identical queued/running keys coalesce. Bound queued distinct keys at 20; return a clear deferred/busy response when full.
- Poll after 10 seconds, then 20, then 30, with jitter and a bounded 120-second execution window. Count each poll against budget. Reserve capacity for at least submission plus one poll before starting a new job.
- If budget is unavailable, retain eligible stale results and return retry_not_before; otherwise show a deferred state. Keep a known submitted job ID so resuming status retrieval does not submit the same query again. A timeout is not evidence the upstream job was cancelled. Replace the browser's current fixed 75-second polling cutoff with a server-provided polling interval and deadline; queued budget-deferred work returns a deferred response rather than holding an active browser poll loop for an hour.
- HTTP 429 establishes a tenant-wide cooldown. Honor a valid Retry-After delta or HTTP date. If no time is provided, use a conservative local one-hour cooldown from observation and label it as an estimate, not DataTap's reset time. Other clients can consume the same quota, so local accounting is only a protective bound.
- Do not retry failed/uncertain POST submissions blindly: absent upstream idempotency support, this can create duplicate paid/quota-consuming jobs. Recover known execution IDs before resubmission.
- HTTP 401/403 stops refreshes, invalidates the affected connection namespace, and hides cached results pending reauthentication/reconfiguration. Never keep serving old data after an authorization failure.
- Network errors, quota errors and upstream transient failures leave stale results available only within existing policy. Negative failures are not result-cache entries; backoff/cooldown is separate state.
- Multi-replica deployment requires shared request accounting, atomic in-flight leases with expiry and fencing tokens, and shared cache eviction. A late worker must not overwrite a newer result after lease expiry.

These measures reduce duplicate load; they cannot guarantee a full dashboard refresh every five minutes under a 25-request/hour limit. The UI must make deferred refreshes visible.

## 8. Persistence, privacy and invalidation

Server policy is authoritative at dataset and field level. The browser cache is readable by JavaScript on the app origin; it is not a secret vault, and client-side encryption with a client-held key does not fix XSS exposure.

Default browser persistence to allowed only for approved fields. Users data, raw JSON, email, serial/device identifiers, network identifiers/IP addresses and location fields require explicit organizational permission before persistence. For a result with mixed fields, the most restrictive policy wins; never silently remove columns to make an entry eligible. Memory-only rendering/reuse remains separately policy-controlled. Never store API keys, authentication tokens, secrets, unrestricted dumps or decrypted server connection records in any browser cache.

- Bootstrap authorization and cache policy before reading persisted analytics. No offline reopening of persisted analytics without a separately approved offline authorization design. An already-authorized open page may retain policy-eligible data through a temporary network failure until its hard expiry.
- Logout: hide results immediately, clear memory/results/metadata/drafts for the active namespace, notify other tabs, and prevent late writes. If deletion fails, old records remain unreadable through normal app lookups; complete cleanup on next successful storage access. Browser storage is not a protection against a malicious local user.
- Tenant/account switch: hide old results before loading the new namespace. Credential/endpoint changes, disconnect/reconnect, role or data-permission changes, demo/live switches, catalog/compiler changes all invalidate the affected namespace before new lookups.
- TTL is not a permission lease. Refresh authorization through existing session rules, receive permission revisions on API responses, and revalidate on tab focus before reusing sensitive cached results. A server hit always checks current permissions.
- Definition edits: save to the server; compute a new key for semantic changes. Keep drafts with baseRevision and require conflict resolution if the server revision changed. Label/visualization-only edits reuse rows with current presentation metadata.
- Ingestion corrections or administrator purge: invalidate affected tenant/dataset/snapshot entries across server and browser notifications. A purge requires authorization.
- Logs/metrics contain cache outcome, timings, sizes and opaque identifiers, not rows, keys/secrets or full query definitions/filter literals. Purge data when policy becomes more restrictive.

## 9. Storage bounds and resilience

Initial limits: 100 MiB total IndexedDB result cache per browser profile, configurable up to 500 MiB; maximum 10 MiB per result. Server cache initial bound: 100 MiB per process and 25 MiB per authorization partition. Oversized results can render but are not cached. Track approximate serialized UTF-8 bytes; browser overhead means actual quota may be reached sooner.

Evict hard-expired entries first, then least-recently-used entries, targeting 80% of the configured bound. Maintain bounded accounting transactionally; batch last-access updates to avoid a disk write per render. Drafts are kept separate from disposable result eviction; warn on unsaved-draft quota failure rather than silently deleting edits.

On quota failure, perform one eviction-and-write retry, then degrade to memory-only. On IndexedDB unavailability, corruption or schema-upgrade blocking, keep the application functional through memory/server caches; coordinate tab upgrades and never delete unrelated drafts to repair results. Never request persistent browser storage silently. Cache loss must affect performance only, not saved definitions or correctness.

## 10. User experience

Tables and widgets show execution age, snapshot date/range when known, and Fresh / Cached / Refreshing / Stale / Refresh deferred states. A dashboard may contain different ages: show each widget's origin time, not one misleading global 'updated now' label. Connectivity status remains status at snapshot.

On refresh failure, retain data with an inline explanation and retry availability. Do not flash an empty state or turn missing telemetry into zero. Show a blocking error only when no eligible result exists. Manual Refresh remains visible during cooldown but explains when it can run. Provide a clear locally cached data action and explain that clearing cache does not delete saved reports.

## 11. Delivery plan and acceptance criteria

1. Shared canonicalization/versioning, server result cache and single-flight registry; tests for authorization, row limits, labels, zero rows and key order. Add request-budget scheduler and recovery of known query IDs before enabling background refresh.
2. Additive API cache envelope and memory cache; dashboard deduplication, request-generation cancellation, visible freshness and deferred/error states.
3. IndexedDB/Dexie integration, server persistence policy, LRU limits, cross-tab coordination, migrations and cleanup. No dependency is installed as part of this design update.
4. Production Redis adapter, distributed leases/budget accounting and operational controls before multiple replicas.

Required checks:

- Equivalent validated object shapes share keys; different column/sort order, scope, limits, preview mode, tenant, user permissions, connection revision and compiler version do not collide.
- A table and two charts over one definition cause one upstream job; simultaneous tabs/users share only when authorized. Fresh cache hits cause zero upstream calls.
- Stale eligible results render immediately, refresh once, preserve warnings/row-limit flags, and update subscribers without applying late results to another view.
- Label changes reuse rows with current labels. True zero-row success is cached; errors never become empty success.
- A 429 without Retry-After creates bounded, visible cooldown; no background retry storm. Explicit refresh cannot bypass quota. Submitted job recovery never duplicates POSTs.
- Logout, permission/tenant/key changes and demo/live switches prevent any old namespace reads or late writes. Disallowed datasets/fields never reach IndexedDB.
- Historical corrections invalidate entries; stale display stops at hard expiry; local reads and clock changes cannot renew TTL.
- Storage-denied, quota-full, evicted and upgraded IndexedDB cases remain usable through memory/server paths. Server definitions survive all cache cleanup.
- Validate LRU bounds, multi-widget cancellation, multi-tab races and distributed lease expiry. Observe hit rate, coalesced jobs, upstream calls, stale age, cooldown duration, cache bytes and refresh failures without logging records.
