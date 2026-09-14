import test from 'node:test';
import assert from 'node:assert/strict';
import { connectivityStatus } from '../server/connectivity.mjs';
import { compile, evaluate } from '../server/query.mjs';
import { seed, makeData } from '../server/demo.mjs';
import {
  migrateConnectivityReports,
  offlineInventoryColumns,
} from '../server/report-migrations.mjs';
test('snapshot status handles threshold boundaries and missing timestamps', () => {
  const snapshot = '2026-09-10T12:00:00Z';
  for (const [seen, expected] of [
    ['2026-09-10T11:30:00Z', 'Online'],
    ['2026-09-10T11:29:59Z', 'Idle'],
    ['2026-09-09T12:00:00Z', 'Idle'],
    ['2026-09-09T11:59:59Z', 'Offline'],
    [null, 'Unknown'],
    ['invalid', 'Unknown'],
  ])
    assert.equal(connectivityStatus(seen, snapshot), expected);
  assert.equal(connectivityStatus('2026-09-10', null), 'Unknown');
});
test('online/offline SQL derives connectivity from real timestamps, not a missing status column', () => {
  for (const id of ['r_online', 'r_offline', 'r_recent']) {
    const q = seed().reports.find((r) => r.id === id).query_definition;
    const sql = compile(q).query;
    assert.ok(!sql.includes('devices.status'));
    assert.match(sql, /TRY_CAST\(devices.last_seen AS TIMESTAMP\)/);
    assert.match(sql, /devices.report_generation_timestamp - INTERVAL 30 MINUTES/);
    assert.match(sql, /INTERVAL 24 HOURS/);
    assert.ok(!sql.includes('devices.model'));
    assert.ok(!sql.includes('devices.battery'));
    assert.ok(evaluate(q, makeData()).rows.length > 0);
  }
});
test('migration fixes the starter inventory without overwriting customized column selections', () => {
  const old = {
    id: 'r_recent',
    query_definition: {
      source: 'devices',
      columns: ['name', 'model', 'groups.group_name', 'os_version', 'battery', 'last_seen'],
      filters: [{ field: 'status', operator: 'equals', value: 'Offline' }],
    },
  };
  const custom = {
    id: 'r_recent',
    query_definition: { source: 'devices', columns: ['device_id', 'name'] },
  };
  const db = { reports: [old, custom] };
  migrateConnectivityReports(db);
  assert.deepEqual(old.query_definition.columns, offlineInventoryColumns);
  assert.deepEqual(custom.query_definition.columns, ['device_id', 'name']);
  assert.equal(old.query_definition.filters[0].value, 'Offline');
});
