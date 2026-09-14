import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, cachePolicy, ResultCache } from '../server/result-cache.mjs';
import { RequestBudget } from '../server/request-budget.mjs';
import { baseQuery } from '../server/demo.mjs';
const q = { ...baseQuery(), columns: ['device_id', 'name'] };
test('cache keys preserve semantic order, scope and isolation while ignoring presentation labels', () => {
  const key = cacheKey('a', q, false);
  assert.equal(key, cacheKey('a', { ...q, labels: { name: 'Renamed' } }, false));
  for (const [ns, patch, preview] of [
    ['b', {}, false],
    ['a', { columns: ['name', 'device_id'] }, false],
    ['a', { limit: 2 }, false],
    ['a', {}, true],
    ['a', { data_scope: { type: 'SNAPSHOT', date: '2026-09-10' } }, false],
  ])
    assert.notEqual(key, cacheKey(ns, { ...q, ...patch }, preview));
});
test('freshness, stale limits, empty results and LRU eviction do not extend source age', () => {
  let now = 1000;
  const c = new ResultCache({ now: () => now, maxBytes: 200, partitionBytes: 200 });
  const policy = { ttl: 1, maxAge: 3, persist_allowed: true };
  const result = { columns: [], rows: [], metadata: { warnings: ['note'] } };
  c.put('n', 'a', result, policy);
  assert.equal(c.envelope(c.get('n', 'a')).state, 'fresh');
  now = 2500;
  assert.equal(c.envelope(c.get('n', 'a')).state, 'stale');
  assert.equal(c.get('n', 'a').fetchedAt, 1000);
  assert.equal(c.get('other', 'a'), null);
  now = 4000;
  assert.equal(c.get('n', 'a'), null);
  for (let i = 0; i < 10; i++) c.put('n', String(i), result, policy);
  assert.ok(c.entries.size < 10);
  assert.ok(c.get('n', '9'));
  c.clear('n');
  assert.equal(c.entries.size, 0);
});
test('historical TTLs and browser persistence use conservative policy', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  assert.equal(cachePolicy(q, now).persist_allowed, false);
  assert.equal(cachePolicy({ ...q, columns: ['os_version'] }, now).persist_allowed, true);
  assert.equal(
    cachePolicy({ ...q, data_scope: { type: 'SNAPSHOT', date: '2026-09-13' } }, now).ttl,
    86400,
  );
  assert.equal(
    cachePolicy({ ...q, data_scope: { type: 'SNAPSHOT', date: '2026-09-14' } }, now).ttl,
    600,
  );
  assert.equal(cachePolicy({ ...q, source: 'device_stats' }, now).ttl, 300);
});
test('request budgets serialize upstream jobs and stop at a shared quota', async () => {
  let now = 1000;
  const b = new RequestBudget({ limit: 2, now: () => now });
  let active = 0,
    max = 0;
  const work = () =>
    b.run('tenant', async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return 1;
    });
  await Promise.all([work(), work()]);
  assert.equal(max, 1);
  b.state('tenant').calls = [1000, 1000];
  assert.throws(
    () => b.check('tenant'),
    (e) => e.statusCode === 'RATE_LIMITED',
  );
  now += 3600001;
  assert.doesNotThrow(() => b.check('tenant'));
});

test('validated numeric representations share cache identity and count-only aggregates may persist', () => {
  const a = { ...q, filters: [{ field: 'battery', operator: 'greater_than', value: '20' }] };
  assert.equal(
    cacheKey('n', a),
    cacheKey('n', { ...a, filters: [{ ...a.filters[0], value: 20 }] }),
  );
  const aggregated = {
    ...q,
    metrics: [{ field: 'device_id', aggregation: 'count_distinct', alias: 'total' }],
  };
  assert.equal(cachePolicy(aggregated).persist_allowed, true);
  assert.equal(cachePolicy({ ...aggregated, group_by: ['device_id'] }).persist_allowed, false);
});

test('request budget counts every HTTP call, persists cooldown and respects Retry-After', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  const original = globalThis.fetch;
  let now = 1000;
  try {
    const b = new RequestBudget({ file: join(dir, 'budget.json'), limit: 25, now: () => now });
    globalThis.fetch = async () =>
      new Response('{}', { status: 429, headers: { 'Retry-After': '60' } });
    await b.request('tenant', 'https://example.test', {});
    assert.equal(b.state('tenant').calls.length, 1);
    assert.throws(
      () => b.check('tenant'),
      (e) => e.retryNotBefore >= 61000,
    );
    const restored = new RequestBudget({
      file: join(dir, 'budget.json'),
      limit: 25,
      now: () => now,
    });
    assert.equal(restored.state('tenant').cooldown, 61000);
    now = 62000;
    assert.doesNotThrow(() => restored.check('tenant'));
  } finally {
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
