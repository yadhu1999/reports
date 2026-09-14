import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectionCandidate, connectionStore, tenantEndpoint } from '../server/connections.mjs';

test('tenant entry is normalized and limited to Esper API hosts', () => {
  assert.deepEqual(tenantEndpoint(' Acme '), {
    tenant: 'acme',
    baseUrl: 'https://acme-api.esper.cloud/api/data-tap/v0',
  });
  for (const value of [
    'https://evil.example',
    'acme.esper.cloud',
    '../acme',
    'a/b',
    '-acme',
    'acme-',
    '',
    'a'.repeat(64),
  ])
    assert.throws(() => tenantEndpoint(value));
});
test('saved keys may be retained only for the same tenant', () => {
  const existing = { ...tenantEndpoint('acme'), apiKey: 'old-key' };
  assert.equal(connectionCandidate({ tenant: 'ACME', apiKey: '' }, existing).apiKey, 'old-key');
  assert.equal(
    connectionCandidate({ tenant: 'other', apiKey: 'new-key' }, existing).apiKey,
    'new-key',
  );
  assert.throws(() => connectionCandidate({ tenant: 'other', apiKey: '' }, existing));
  assert.throws(() => connectionCandidate({ tenant: 'acme', apiKey: 'invalid\nkey' }, existing));
});
test('encrypted connection persistence is isolated by workspace and supports removal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'connection-store-'));
  try {
    const store = connectionStore(dir);
    store.write('workspace-a', { ...tenantEndpoint('acme'), apiKey: 'secret-A' });
    store.write('workspace-b', { ...tenantEndpoint('other'), apiKey: 'secret-B' });
    const disk = readFileSync(join(dir, 'connections.json'), 'utf8');
    assert.ok(!disk.includes('secret-A'));
    assert.ok(!disk.includes('secret-B'));
    assert.equal(statSync(join(dir, 'connection.key')).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'connections.json')).mode & 0o777, 0o600);
    const reopened = connectionStore(dir);
    assert.equal(reopened.read('workspace-a').apiKey, 'secret-A');
    assert.equal(reopened.read('workspace-b').apiKey, 'secret-B');
    assert.equal(reopened.read('unknown'), undefined);
    reopened.write('workspace-a', null);
    assert.equal(connectionStore(dir).read('workspace-a').enabled, false);
    assert.equal(connectionStore(dir).read('workspace-b').apiKey, 'secret-B');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
