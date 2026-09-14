import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port = 3139;
test('connection settings verify before saving, activate live queries, survive restart and disconnect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'connection-api-'));
  let server;
  async function start() {
    server = spawn(
      process.execPath,
      ['--import', './tests/fixtures/datatap-fetch.mjs', 'server/index.mjs'],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DEMO_MODE: 'true',
          DATATAP_TENANTS: '{}',
          DATA_DIR: dir,
          PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Server startup timeout')), 10000);
      server.stdout.on('data', (d) => {
        if (String(d).includes('DataTap Reporting')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('Server exited ' + code));
      });
    });
  }
  async function stop() {
    if (server && !server.killed) {
      const done = new Promise((r) => server.once('exit', r));
      server.kill();
      await done;
    }
  }
  async function request(path, method = 'GET', body) {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  }
  async function execute() {
    const job = await request('/reports/r_total/execute', 'POST');
    assert.equal(job.status, 202);
    for (let i = 0; i < 30; i++) {
      const r = await request('/reporting/executions/' + job.data.execution_id);
      if (r.data.status === 'complete') return r.data;
      if (r.data.status === 'failed') throw Error(r.data.error);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Execution timeout');
  }
  try {
    await start();
    assert.equal((await request('/connection')).data.mode, 'demo');
    assert.equal(
      (await request('/connection/test', 'POST', { tenant: 'acme', apiKey: 'mock-valid-key' }))
        .status,
      200,
    );
    assert.equal((await request('/connection')).data.mode, 'demo');
    assert.equal(
      (await request('/connection', 'PUT', { tenant: 'evil.example', apiKey: 'mock-valid-key' }))
        .status,
      400,
    );
    assert.equal(
      (await request('/connection', 'PUT', { tenant: 'acme', apiKey: 'wrong-key' })).status,
      400,
    );
    assert.equal((await request('/connection')).data.hasApiKey, false);
    const saved = await request('/connection', 'PUT', { tenant: 'acme', apiKey: 'mock-valid-key' });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.mode, 'live');
    assert.equal(saved.data.hasApiKey, true);
    assert.ok(!JSON.stringify(saved).includes('mock-valid-key'));
    assert.ok(!('apiKey' in saved.data));
    const live = await execute();
    assert.equal(live.metadata.mode, 'live');
    assert.deepEqual(live.rows, [[7]]);
    assert.equal((await request('/session')).data.mode, 'live');
    assert.equal((await request('/session')).data.localWorkspace, true);
    assert.equal((await request('/connection', 'PUT', { tenant: 'acme', apiKey: '' })).status, 200);
    assert.equal(
      (await request('/connection', 'PUT', { tenant: 'other', apiKey: '' })).status,
      400,
    );
    assert.equal(
      (await request('/connection', 'PUT', { tenant: 'acme', apiKey: 'wrong-key' })).status,
      400,
    );
    assert.equal((await request('/connection')).data.mode, 'live');
    assert.ok(!readFileSync(join(dir, 'connections.json'), 'utf8').includes('mock-valid-key'));
    assert.ok(!readFileSync(join(dir, 'demo.json'), 'utf8').includes('mock-valid-key'));
    await stop();
    await start();
    assert.equal((await request('/connection')).data.tenant, 'acme');
    assert.deepEqual((await execute()).rows, [[7]]);
    assert.equal((await request('/connection', 'DELETE')).data.mode, 'demo');
    assert.equal((await request('/connection')).data.hasApiKey, false);
    assert.equal((await execute()).metadata.mode, 'demo');
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
