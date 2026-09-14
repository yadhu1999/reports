import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareChartData } from '../src/chart-data.mjs';
import { migrateCannedPresentation } from '../server/report-migrations.mjs';
test('category bucketing preserves every measure total without altering source rows', () => {
  const rows = Array.from({ length: 316 }, (_, i) => ({
    group: 'Group ' + i,
    devices: i + 1,
    other: 2,
  }));
  const { data, combined } = prepareChartData(rows, 'group', ['devices', 'other'], 10);
  assert.equal(data.length, 10);
  assert.equal(combined, 307);
  for (const m of ['devices', 'other'])
    assert.equal(
      data.reduce((s, r) => s + r[m], 0),
      rows.reduce((s, r) => s + r[m], 0),
    );
  assert.equal(rows[0].group, 'Group 0');
  assert.equal(data[0].devices, 316);
});
test('empty and null categories remain explicit and do not disappear', () => {
  const r = prepareChartData(
    [
      { os: null, count: 5 },
      { os: '', count: 7 },
    ],
    'os',
    ['count'],
  );
  assert.deepEqual(
    r.data.map((x) => x.os),
    ['Not reported', 'Empty value'],
  );
  assert.equal(
    r.data.reduce((s, r) => s + r.count, 0),
    12,
  );
});
test('canned presentation migration clarifies semantics and preserves renamed user reports', () => {
  const db = {
    reports: [
      { id: 'r_groups', name: 'Devices by location' },
      { id: 'r_trend', name: 'My custom trend' },
    ],
    visualizations: [],
  };
  migrateCannedPresentation(db);
  assert.equal(db.reports[0].name, 'Devices by group name');
  assert.equal(db.reports[1].name, 'My custom trend');
});
