import Dexie, { type Table } from 'dexie';
import type { Result } from './types';
type Entry = {
  key: string;
  namespace: string;
  result: Result;
  expiresAt: number;
  staleUntil: number;
  lastAccessedAt: number;
  sizeBytes: number;
};
class CacheDB extends Dexie {
  queryResults!: Table<Entry, string>;
  metadata!: Table<{ key: string; value: any; expiresAt: number }, string>;
  constructor() {
    super('esper-reporting-cache');
    this.version(1).stores({
      queryResults: 'key, namespace, staleUntil, lastAccessedAt',
      metadata: 'key, expiresAt',
    });
  }
}
const db = new CacheDB();
const memory = new Map<string, Entry>();
let generation = 0;
let activeNamespace: string | null = null;
let serverAnchor = Date.now(),
  monotonicAnchor = performance.now();
export function setCacheTime(time: string) {
  const parsed = Date.parse(time);
  if (Number.isFinite(parsed)) {
    serverAnchor = parsed;
    monotonicAnchor = performance.now();
  }
}
export function cacheNow() {
  return serverAnchor + performance.now() - monotonicAnchor;
}
export async function acceptNamespace(namespace: string) {
  if (activeNamespace && activeNamespace !== namespace) await clearLocalCache();
  activeNamespace = namespace;
}

const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('esper-reporting-cache');
export const cacheGeneration = () => generation;
export async function clearLocalCache(broadcast = true) {
  generation++;
  memory.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('report-cache-cleared'));
  if (broadcast) channel?.postMessage({ type: 'clear' });
  try {
    await db.queryResults.clear();
    await db.metadata.clear();
  } catch {
    /* Browser storage is disposable. */
  }
}
channel?.addEventListener('message', (event) => {
  if (event.data?.type === 'clear') void clearLocalCache(false);
  else if (event.data?.key) memory.delete(event.data.key);
});
function trimMemory() {
  let size = [...memory.values()].reduce((n, e) => n + e.sizeBytes, 0);
  while (memory.size > 50 || size > 30 * 1024 * 1024) {
    const key = memory.keys().next().value!;
    size -= memory.get(key)!.sizeBytes;
    memory.delete(key);
  }
}
export async function readResult(
  namespace: string,
  key: string,
  now: number,
  persist: boolean,
): Promise<Result | null> {
  let entry = memory.get(key);
  let source = 'memory';
  if (!entry && persist) {
    try {
      entry = await db.queryResults.get(key);
      source = 'indexeddb';
    } catch {
      /* Memory/server fallback. */
    }
  }
  if (!entry || entry.namespace !== namespace || entry.staleUntil <= now) {
    memory.delete(key);
    return null;
  }
  if (!persist && source === 'indexeddb') return null;
  entry.lastAccessedAt = Date.now();
  memory.delete(key);
  memory.set(key, entry);
  trimMemory();
  if (persist)
    void db.queryResults.update(key, { lastAccessedAt: entry.lastAccessedAt }).catch(() => {});
  return {
    ...entry.result,
    cache: { ...entry.result.cache!, source, state: entry.expiresAt > now ? 'fresh' : 'stale' },
  };
}
export async function saveResult(result: Result, expectedGeneration: number) {
  const cache = result.cache;
  if (
    generation !== expectedGeneration ||
    !cache?.browser_cache_allowed ||
    !cache.expires_at ||
    !cache.stale_until
  )
    return;
  const clean: Result = {
    execution_id: '',
    status: 'complete',
    columns: result.columns,
    rows: result.rows,
    metadata: result.metadata,
    cache: { ...cache, refresh_execution_id: null },
  };
  const sizeBytes = new TextEncoder().encode(JSON.stringify(clean)).length;
  if (sizeBytes > 10 * 1024 * 1024) return;
  const entry: Entry = {
    key: cache.key,
    namespace: cache.namespace,
    result: clean,
    expiresAt: Date.parse(cache.expires_at),
    staleUntil: Date.parse(cache.stale_until),
    lastAccessedAt: Date.now(),
    sizeBytes,
  };
  memory.delete(entry.key);
  memory.set(entry.key, entry);
  trimMemory();
  if (!cache.persist_allowed) return;
  try {
    await db.transaction('rw', db.queryResults, async () => {
      if (generation !== expectedGeneration) return;
      await db.queryResults.where('staleUntil').belowOrEqual(cacheNow()).delete();
      const entries = await db.queryResults.orderBy('lastAccessedAt').toArray();
      let size = entries.reduce((n, e) => n + e.sizeBytes, 0) + sizeBytes;
      for (const old of entries) {
        if (size <= 80 * 1024 * 1024) break;
        await db.queryResults.delete(old.key);
        size -= old.sizeBytes;
      }
      await db.queryResults.put(entry);
    });
    if (generation !== expectedGeneration) {
      await db.queryResults.delete(entry.key);
      return;
    }
    channel?.postMessage({ type: 'updated', key: entry.key });
  } catch {
    /* Quota or denied storage must never fail a report. */
  }
}
export async function cacheMetadata(namespace: string, value: any) {
  try {
    await db.metadata.put({ key: namespace, value, expiresAt: Date.now() + 12 * 3600000 });
  } catch {}
}

export async function readMetadata(namespace: string, now: number) {
  try {
    const entry = await db.metadata.get(namespace);
    return entry && entry.expiresAt > now ? entry.value : null;
  } catch {
    return null;
  }
}
