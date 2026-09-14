import { fieldsFor } from './catalog.mjs';
import { createHash } from 'node:crypto';
import { canonicalQuery } from '../shared/cache-identity.mjs';
export function cacheKey(namespace, q, preview) {
  const fields = fieldsFor(q);
  q = {
    ...q,
    filters: q.filters.map((f) => ({
      ...f,
      value:
        fields.find((x) => x.id === f.field)?.type === 'number' && f.value != null
          ? Array.isArray(f.value)
            ? f.value.map(Number)
            : Number(f.value)
          : f.value,
    })),
  };
  return createHash('sha256')
    .update(namespace + '\n' + canonicalQuery(q, preview))
    .digest('hex');
}
export function cachePolicy(q, now = Date.now(), allowSensitive = false) {
  const today = new Date(now).toISOString().slice(0, 10);
  const historical =
    q.data_scope.type === 'SNAPSHOT'
      ? q.data_scope.date < today
      : q.data_scope.type === 'DATE_RANGE' && q.data_scope.to < today;
  const ttl = historical ? 86400 : q.source === 'device_stats' ? 300 : 600;
  const maxAge = historical ? 604800 : q.source === 'device_stats' ? 1800 : 3600;
  const fields = [
    ...(q.metrics.length ? [] : q.columns),
    ...q.group_by,
    ...q.filters.map((f) => f.field),
    ...q.metrics
      .filter((m) => !['count', 'count_distinct'].includes(m.aggregation))
      .map((m) => m.field),
  ];
  const sensitive =
    q.source === 'users' ||
    fields.some((f) =>
      /device_id|^name$|serial|email|latitude|longitude|altitude|wifi|ipv[46]|operator|tenant_id|_stats$/.test(
        f,
      ),
    );
  return { ttl, maxAge, persist_allowed: allowSensitive || !sensitive };
}
export class ResultCache {
  constructor({
    now = Date.now,
    maxBytes = 100 * 1024 * 1024,
    partitionBytes = 25 * 1024 * 1024,
  } = {}) {
    this.now = now;
    this.maxBytes = maxBytes;
    this.partitionBytes = partitionBytes;
    this.entries = new Map();
    this.pending = new Map();
    this.resume = new Map();
  }
  get(namespace, key) {
    const entry = this.entries.get(key);
    if (!entry || entry.namespace !== namespace) return null;
    if (entry.staleUntil <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
  put(namespace, key, result, policy) {
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > 10 * 1024 * 1024) return null;
    const entry = {
      namespace,
      key,
      result: structuredClone(result),
      bytes,
      fetchedAt: this.now(),
      expiresAt: this.now() + policy.ttl * 1000,
      staleUntil: this.now() + policy.maxAge * 1000,
      policy,
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const [k, v] of this.entries) if (v.staleUntil <= this.now()) this.entries.delete(k);
    const size = (ns) =>
      [...this.entries.values()]
        .filter((v) => !ns || v.namespace === ns)
        .reduce((n, v) => n + v.bytes, 0);
    for (const [k, v] of this.entries) {
      if (size(namespace) <= this.partitionBytes) break;
      if (v.namespace === namespace) this.entries.delete(k);
    }
    while (size() > this.maxBytes) this.entries.delete(this.entries.keys().next().value);
    return entry;
  }
  clear(namespace) {
    for (const [k, v] of this.entries) if (v.namespace === namespace) this.entries.delete(k);
    for (const [k, v] of this.resume) if (v.namespace === namespace) this.resume.delete(k);
  }
  envelope(entry, source = 'server') {
    return {
      namespace: entry.namespace,
      key: entry.key,
      source,
      state: entry.expiresAt > this.now() ? 'fresh' : 'stale',
      server_time: new Date(this.now()).toISOString(),
      fetched_at: new Date(entry.fetchedAt).toISOString(),
      expires_at: new Date(entry.expiresAt).toISOString(),
      stale_until: new Date(entry.staleUntil).toISOString(),
      ttl_seconds: entry.policy.ttl,
      immutable: false,
      browser_cache_allowed: true,
      persist_allowed: entry.policy.persist_allowed,
      snapshot_range: null,
      refresh_execution_id: null,
      retry_not_before: null,
    };
  }
}
