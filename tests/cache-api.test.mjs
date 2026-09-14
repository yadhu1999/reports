import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseQuery } from '../server/demo.mjs';
test('server reuses and coalesces queries, relabels results, refreshes and invalidates connection namespaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-api-'));
  const port = 3142;
  const server = spawn(
    process.execPath,
    ['--import', './tests/fixtures/cache-fetch.mjs', 'server/index.mjs'],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        DATA_DIR: dir,
        PORT: String(port),
        CACHE_TEST_CALLS: join(dir, 'calls'),
        DATATAP_TENANTS: '{}',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const call = async (path, method = 'GET', body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const wait = async (id) => {
    for (let i = 0; i < 100; i++) {
      const r = await call('/reporting/executions/' + id);
      if (r.data.status === 'complete') return r.data;
      if (r.data.status === 'failed') throw Error(r.data.error);
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('Test execution timed out');
  };
  const count = () => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').length;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Server startup timed out')), 10000);
      server.stdout.on('data', (d) => {
        if (String(d).includes('DataTap Reporting')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Server failed'));
      });
    });
    await call('/connection', 'PUT', { tenant: 'test', apiKey: 'fixture-key' });
    const baseline = count();
    const q = { ...baseQuery(), columns: ['device_id'], limit: 1 };
    const start = (labels) => call('/reporting/query/execute', 'POST', { ...q, labels });
    const jobs = await Promise.all([start({ device_id: 'One' }), start({ device_id: 'Two' })]);
    const results = await Promise.all(jobs.map((j) => wait(j.data.execution_id)));
    assert.equal(count(), baseline + 1);
    assert.equal(results[0].columns[0].label, 'One');
    assert.equal(results[1].columns[0].label, 'Two');
    const hit = await wait((await start({})).data.execution_id);
    assert.equal(hit.cache.source, 'server');
    assert.equal(count(), baseline + 1);
    assert.equal(hit.cache.persist_allowed, false);
    const refresh = await call('/reporting/query/execute', 'POST', q, {
      'X-Report-Cache-Intent': 'revalidate',
    });
    const stale = await wait(refresh.data.execution_id);
    assert.ok(stale.cache.refresh_execution_id);
    await wait(stale.cache.refresh_execution_id);
    assert.equal(count(), baseline + 2);
    await call('/connection', 'PUT', { tenant: 'other', apiKey: 'new-fixture-key' });
    assert.equal((await call('/reporting/executions/' + results[0].execution_id)).status, 404);
    const next = await wait((await start({})).data.execution_id);
    assert.notEqual(next.cache.namespace, hit.cache.namespace);
  } finally {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
