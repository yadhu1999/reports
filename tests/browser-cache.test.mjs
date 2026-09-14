import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
test('IndexedDB caches eligible rows, isolates namespaces, enforces expiry and handles storage failure', async () => {
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  const originalChannel = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = undefined;
  const dir = mkdtempSync(join(process.cwd(), 'tests/.browser-cache-'));
  const source = readFileSync('src/result-cache.ts', 'utf8');
  const code =
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText + '\nexport const testDB=db;';
  writeFileSync(join(dir, 'cache.mjs'), code);
  let first, second;
  try {
    first = await import(join(dir, 'cache.mjs'));
    const now = Date.now();
    const result = {
      execution_id: 'never-persist-handle',
      status: 'complete',
      columns: [],
      rows: [],
      metadata: {
        executed_at: new Date(now).toISOString(),
        row_count: 0,
        mode: 'live',
        warnings: ['test'],
      },
      cache: {
        namespace: 'one',
        key: 'k',
        state: 'fresh',
        source: 'upstream',
        browser_cache_allowed: true,
        persist_allowed: true,
        expires_at: new Date(now + 1000).toISOString(),
        stale_until: new Date(now + 3000).toISOString(),
      },
    };
    await first.saveResult(result, first.cacheGeneration());
    second = await import(join(dir, 'cache.mjs') + '?second');
    const hit = await second.readResult('one', 'k', now, true);
    assert.equal(hit.cache.source, 'indexeddb');
    assert.deepEqual(hit.rows, []);
    assert.equal(hit.execution_id, '');
    assert.equal(await second.readResult('two', 'k', now, true), null);
    assert.equal((await second.readResult('one', 'k', now + 1500, true)).cache.state, 'stale');
    assert.equal(await second.readResult('one', 'k', now + 4000, true), null);
    await first.saveResult(
      { ...result, cache: { ...result.cache, key: 'private', persist_allowed: false } },
      first.cacheGeneration(),
    );
    assert.equal(await first.testDB.queryResults.get('private'), undefined);
    const generation = first.cacheGeneration();
    await first.clearLocalCache();
    await first.saveResult(result, generation);
    assert.equal(await first.testDB.queryResults.get('k'), undefined);
    const put = first.testDB.queryResults.put;
    first.testDB.queryResults.put = async () => {
      throw Error('QuotaExceededError');
    };
    await first.saveResult(result, first.cacheGeneration());
    assert.ok(await first.readResult('one', 'k', now, true));
    first.testDB.queryResults.put = put;
  } finally {
    first?.testDB.close();
    second?.testDB.close();
    globalThis.BroadcastChannel = originalChannel;
    rmSync(dir, { recursive: true, force: true });
  }
});
