import type { Query, Result } from './types';
import {
  readResult,
  saveResult,
  clearLocalCache,
  cacheGeneration,
  readMetadata,
  acceptNamespace,
  setCacheTime,
  cacheNow,
  cacheMetadata,
} from './result-cache';
import { applyLabels } from '../shared/cache-identity.mjs';
export { clearLocalCache } from './result-cache';
export async function api<T = any>(
  url: string,
  method = 'GET',
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  if (
    (url === '/login' || url === '/logout' || url === '/connection') &&
    ['PUT', 'DELETE', 'POST'].includes(method)
  )
    await clearLocalCache();
  let metadataContext: any;
  let metadataGeneration = cacheGeneration();
  if (url === '/reporting/datasets' && method === 'GET') {
    metadataContext = await api('/cache/context');
    if (metadataGeneration !== cacheGeneration()) throw new DOMException('Aborted', 'AbortError');
    setCacheTime(metadataContext.server_time);
    await acceptNamespace(metadataContext.namespace);
    metadataGeneration = cacheGeneration();
    const cached = await readMetadata(
      metadataContext.namespace,
      Date.parse(metadataContext.server_time),
    );
    if (metadataGeneration !== cacheGeneration()) throw new DOMException('Aborted', 'AbortError');
    if (cached) return cached;
  }
  const r = await fetch('/api' + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    if ([401, 403, 404].includes(r.status)) await clearLocalCache();
    throw Object.assign(Error(data.error || 'Unable to complete this request.'), {
      status: r.status,
    });
  }
  if (metadataContext && metadataGeneration === cacheGeneration())
    await cacheMetadata(metadataContext.namespace, data);
  return data;
}
const flights = new Map<string, Promise<Result>>();
function share(key: string, fn: () => Promise<Result>) {
  let promise = flights.get(key);
  if (!promise) {
    promise = fn();
    flights.set(key, promise);
    promise.then(
      () => flights.delete(key),
      () => flights.delete(key),
    );
  }
  return promise;
}
export async function run(
  q: Query,
  preview = false,
  signal?: AbortSignal,
  revalidate = false,
  onUpdate?: (r: Result) => void,
): Promise<Result> {
  // Current server authorization and policy are required before a persisted read.
  const beforePrepare = cacheGeneration();
  const context = await api('/cache/prepare', 'POST', { query: q, preview });
  if (beforePrepare !== cacheGeneration()) throw new DOMException('Aborted', 'AbortError');
  setCacheTime(context.server_time);
  await acceptNamespace(context.namespace);
  const generation = cacheGeneration();
  const active = () => !signal?.aborted && generation === cacheGeneration();
  const now = Date.parse(context.server_time);
  let cached = await readResult(
    context.namespace,
    context.key,
    now,
    context.policy.persist_allowed,
  );
  if (cached) cached = applyLabels(cached, q);
  const work = () =>
    share(context.key, async () => {
      const canonical = { ...q, labels: {}, metrics: q.metrics.map(({ label, ...m }) => m) };
      const job = await api(
        '/reporting/query/' + (preview ? 'preview' : 'execute'),
        'POST',
        canonical,
        { 'X-Report-Cache-Intent': revalidate ? 'revalidate' : 'default' },
      );
      return poll(job.execution_id);
    });
  const update = async (result: Result): Promise<Result> => {
    if (!active() || result.cache?.namespace !== context.namespace)
      throw new DOMException('Aborted', 'AbortError');
    const presented = applyLabels(result, q);
    await saveResult(result, generation);
    if (result.cache?.refresh_execution_id) {
      const id = result.cache.refresh_execution_id;
      void share('refresh:' + id, () => poll(id))
        .then(async (fresh) => {
          if (!active()) return;
          await saveResult(fresh, generation);
          if (active()) onUpdate?.(applyLabels(fresh, q));
        })
        .catch((error) => {
          if (!active()) return;
          if (Date.parse(presented.cache?.stale_until || '') <= cacheNow()) {
            onUpdate?.({
              ...presented,
              rows: [],
              cache: { ...presented.cache!, state: 'expired', refresh_error: error.message },
            });
            return;
          }
          onUpdate?.({
            ...presented,
            cache: {
              ...presented.cache!,
              refresh_execution_id: null,
              refresh_error: error.message,
            },
          });
        });
    }
    return presented;
  };
  if (!active()) throw new DOMException('Aborted', 'AbortError');
  if (cached && cached.cache?.state === 'fresh' && !revalidate) return cached;
  if (cached) {
    void work()
      .then(update)
      .then((r) => {
        if (active()) onUpdate?.(r);
      })
      .catch((error) => {
        if (active())
          onUpdate?.({
            ...cached!,
            cache: { ...cached!.cache!, refresh_execution_id: null, refresh_error: error.message },
          });
      });
    return {
      ...cached,
      cache: { ...cached.cache!, state: 'stale', refresh_execution_id: 'pending' },
    };
  }
  return update(await work());
}
export async function poll(id: string, signal?: AbortSignal): Promise<Result> {
  const deadline = Date.now() + 270000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const r = await api<Result & { failure_state?: string; retry_not_before?: string }>(
      '/reporting/executions/' + id,
    );
    if (r.status === 'complete') return r;
    if (r.status === 'failed') {
      if (r.failure_state === 'AUTHORIZATION_FAILED') await clearLocalCache();
      throw Error(r.error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error(
    'This report is taking longer than expected. Try again; an existing upstream job will be resumed when available.',
  );
}
export const fmt = (v: any) =>
  typeof v === 'number'
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(v)
    : String(v ?? '—');
export const shortDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export function exportCSV(r: Result, name: string) {
  if (r.cache?.stale_until && Date.parse(r.cache.stale_until) <= cacheNow()) {
    window.alert('Cached results have expired. Refresh the report before exporting.');
    return;
  }
  const safe = (v: any) => {
    let s = String(v ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const csv = [r.columns.map((c) => c.label), ...r.rows]
    .map((row) => row.map(safe).join(','))
    .join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = name + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
