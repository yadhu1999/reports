import { cacheNow } from './result-cache';
import { useEffect, useState } from 'react';
import type { Result } from './types';
export function useCacheView(setResult: (result: Result | null) => void) {
  const [wake, setWake] = useState(0);
  useEffect(() => {
    const clear = () => setResult(null);
    const focus = () => {
      if (document.visibilityState === 'visible') setWake((n) => n + 1);
    };
    window.addEventListener('report-cache-cleared', clear);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('report-cache-cleared', clear);
      window.removeEventListener('focus', focus);
    };
  }, [setResult]);
  return wake;
}
export function useCacheExpired(result: Result) {
  const [now, setNow] = useState(cacheNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(cacheNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  return !!result.cache?.stale_until && Date.parse(result.cache.stale_until) <= now;
}
export function CacheStatus({ result }: { result: Result }) {
  const [now, setNow] = useState(cacheNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(cacheNow()), 30000);
    return () => clearInterval(timer);
  }, []);
  const c = result.cache;
  if (!c) return null;
  const age = Math.max(
    0,
    Math.floor((now - Date.parse(c.fetched_at || result.metadata.executed_at)) / 60000),
  );
  const expired = !!c.stale_until && Date.parse(c.stale_until) <= now;
  const stale = !!c.expires_at && Date.parse(c.expires_at) <= now;
  return (
    <p className="chart-data-note" role="status">
      {expired ? 'Expired' : stale ? 'Stale' : c.source === 'upstream' ? 'Fetched' : 'Cached'} ·{' '}
      {age < 1 ? 'Fetched just now' : `Fetched ${age} min ago`}
      {c.refresh_execution_id ? ' · Refreshing…' : ''}
      {c.refresh_error ? ` · Refresh deferred: ${c.refresh_error}` : ''}
      {expired ? ' · Refresh to load results.' : ''}
    </p>
  );
}

export function CachedKpi({ result }: { result: Result }) {
  const expired = useCacheExpired(result);
  const value = expired ? null : result.rows[0]?.[0];
  return (
    <>
      <CacheStatus result={result} />
      <div className="kpi-number">
        {value == null
          ? '—'
          : typeof value === 'number'
            ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
            : String(value)}
      </div>
    </>
  );
}
