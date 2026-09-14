import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { baseQuery } from '../server/demo.mjs';
const port = 3137;
const base = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(join(tmpdir(), 'reporting-test-'));
const hash = 'scrypt:integration:' + scryptSync('test-password', 'integration', 64).toString('hex');
const users = [
  {
    id: 'a',
    name: 'Analyst',
    email: 'a@example.test',
    passwordHash: hash,
    tenant: 'tenant-a',
    role: 'analyst',
  },
  {
    id: 'b',
    name: 'Other tenant',
    email: 'b@example.test',
    passwordHash: hash,
    tenant: 'tenant-b',
    role: 'analyst',
  },
  {
    id: 'v',
    name: 'Viewer',
    email: 'v@example.test',
    passwordHash: hash,
    tenant: 'tenant-a',
    role: 'viewer',
  },
];
let server;
async function start() {
  server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      SESSION_SECRET: 'integration-test-secret-32-characters-long',
      REPORTING_USERS: JSON.stringify(users),
      DATA_DIR: dir,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Test server did not start')), 10000);
    server.stdout.on('data', (data) => {
      if (String(data).includes('DataTap Reporting')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('exit', (code) => {
      clearTimeout(timeout);
      reject(Error('Server exited ' + code));
    });
    server.stderr.on('data', (data) => {
      if (String(data).includes('Error')) {
        clearTimeout(timeout);
        reject(Error(String(data)));
      }
    });
  });
}
async function stop() {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
}
async function request(path, method = 'GET', body, cookie, origin) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get('set-cookie')?.split(';')[0],
  };
}
async function login(email) {
  const r = await request('/login', 'POST', { email, password: 'test-password' });
  assert.equal(r.status, 200);
  return r.cookie;
}
test('API authentication, roles, tenant isolation, persistence, execution and reference safety', async (t) => {
  await start();
  try {
    assert.equal((await request('/reports')).status, 401);
    assert.equal((await request('/connection')).status, 401);
    assert.equal(
      (await request('/login', 'POST', { email: 'a@example.test', password: 'wrong' })).status,
      401,
    );
    const a = await login('a@example.test'),
      b = await login('b@example.test'),
      v = await login('v@example.test');
    assert.equal((await request('/session', 'GET', undefined, a)).data.user.tenant, 'tenant-a');
    assert.equal(
      (await request('/reports', 'POST', { name: 'Denied', query_definition: baseQuery() }, v))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          '/reports',
          'POST',
          { name: 'Cross origin', query_definition: baseQuery() },
          a,
          'https://evil.example',
        )
      ).status,
      403,
    );
    for (const method of ['GET', 'PUT', 'DELETE'])
      assert.equal(
        (
          await request(
            '/connection',
            method,
            method === 'PUT' ? { tenant: 'acme', apiKey: 'test-key' } : undefined,
            a,
          )
        ).status,
        403,
      );
    assert.equal(
      (await request('/connection/test', 'POST', { tenant: 'acme', apiKey: 'test-key' }, v)).status,
      403,
    );
    const created = await request(
      '/reports',
      'POST',
      { name: 'Inventory', query_definition: baseQuery() },
      a,
    );
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal((await request('/reports/' + id, 'GET', undefined, b)).status, 404);
    assert.equal((await request('/reports', 'GET', undefined, b)).data.length, 0);
    assert.equal(
      (
        await request(
          '/reports/' + id,
          'PUT',
          { name: 'Hijacked', query_definition: baseQuery() },
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          '/reports/' + id,
          'PUT',
          { name: 'Updated inventory', query_definition: baseQuery() },
          a,
        )
      ).status,
      200,
    );
    const copy = await request('/reports/' + id + '/duplicate', 'POST', undefined, a);
    assert.equal(copy.status, 201);
    assert.notEqual(copy.data.id, id);
    const viz = await request(
      '/visualizations',
      'POST',
      {
        name: 'Inventory table',
        report_id: id,
        visualization_definition: { type: 'table', measures: [], options: {} },
      },
      a,
    );
    assert.equal(viz.status, 201);
    assert.equal(
      (
        await request(
          '/visualizations',
          'POST',
          {
            name: 'Bad chart',
            report_id: id,
            visualization_definition: { type: 'pie', measures: [], options: {} },
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal((await request('/reports/' + id, 'DELETE', undefined, a)).status, 409);
    const dash = await request(
      '/dashboards',
      'POST',
      {
        name: 'Operations',
        widgets: [
          {
            id: 'w1',
            type: 'visualization',
            resource_id: viz.data.id,
            layout: { width: 6, height: 4 },
          },
        ],
      },
      a,
    );
    assert.equal(dash.status, 201);
    assert.equal(
      (
        await request(
          '/dashboards',
          'POST',
          {
            name: 'Leaked reference',
            widgets: [
              { id: 'w1', type: 'report', resource_id: id, layout: { width: 6, height: 4 } },
            ],
          },
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request('/visualizations/' + viz.data.id, 'DELETE', undefined, a)).status,
      409,
    );
    const job = await request('/reports/' + id + '/execute', 'POST', undefined, a);
    assert.equal(job.status, 202);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      (await request('/reporting/executions/' + job.data.execution_id, 'GET', undefined, b)).status,
      404,
    );
    const execution = await request(
      '/reporting/executions/' + job.data.execution_id,
      'GET',
      undefined,
      a,
    );
    assert.equal(execution.data.status, 'failed');
    assert.match(execution.data.error, /not configured/);
    assert.equal(
      (await request('/reporting/query/execute', 'POST', { sql: 'DROP TABLE users' }, a)).status,
      400,
    );
    assert.equal((await request('/audit-events', 'GET', undefined, v)).status, 403);
    await stop();
    await start();
    const a2 = await login('a@example.test');
    assert.equal(
      (await request('/reports/' + id, 'GET', undefined, a2)).data.name,
      'Updated inventory',
    );
    assert.equal(
      (await request('/dashboards/' + dash.data.id, 'DELETE', undefined, a2)).status,
      200,
    );
    assert.equal(
      (await request('/visualizations/' + viz.data.id, 'DELETE', undefined, a2)).status,
      200,
    );
    assert.equal((await request('/reports/' + id, 'DELETE', undefined, a2)).status, 200);
    assert.equal((await request('/reports/' + id, 'GET', undefined, a2)).status, 404);
    const stored = JSON.parse(readFileSync(join(dir, 'reporting.json')));
    assert.ok(stored.audit_events.some((e) => e.action === 'execute'));
    assert.ok(!JSON.stringify(stored).includes('test-password'));
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
