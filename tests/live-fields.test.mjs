import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../server/catalog.mjs';
import { compile, evaluate } from '../server/query.mjs';
import { baseQuery } from '../server/demo.mjs';
import { liveWarnings, unavailableFields } from '../server/live-fields.mjs';
import { executeDataTap } from '../server/datatap.mjs';
const schema = JSON.parse(readFileSync(new URL('./fixtures/datatap-schema.json', import.meta.url)));

test('every catalog selection references only columns verified in the live schema', () => {
  for (const dataset of catalog) {
    const q = {
      ...baseQuery(),
      source: dataset.id,
      columns: dataset.fields.map((f) => f.id),
      related: (dataset.relationships || []).map((r) => r.id),
    };
    q.columns.push(...(dataset.relationships || []).flatMap((r) => r.fields.map((f) => f.id)));
    const sql = compile(q).query;
    for (const [, table, column] of sql.matchAll(
      /\b(devices|device_stats|device_apps|groups|users)\.([a-z_]+)\b/g,
    ))
      assert.ok(schema[table].includes(column), `${table}.${column} is not a live column`);
  }
});
test('renamed fields map to the matching semantics', () => {
  for (const [source, field, expected] of [
    ['devices', 'model', "get_json_object(devices.hardware_info, '$.model')"],
    ['device_apps', 'version', 'device_apps.version_name'],
    ['users', 'role', 'users.role_name'],
  ])
    assert.ok(compile({ ...baseQuery(), source, columns: [field] }).query.includes(expected));
});
test('unavailable fields remain explicit in details and cannot produce misleading filtered or aggregated live reports', async () => {
  for (const [source, fields] of Object.entries(unavailableFields))
    for (const field of Object.keys(fields)) {
      const q = { ...baseQuery(), source, columns: [field] };
      assert.equal(liveWarnings(q).length, 1);
      for (const patch of [
        { filters: [{ field, operator: 'is_empty' }] },
        { group_by: [field], metrics: [{ field, aggregation: 'count', alias: 'total' }] },
        { metrics: [{ field, aggregation: 'count', alias: 'total' }] },
      ]) {
        let called = false;
        await assert.rejects(
          executeDataTap(
            { ...q, ...patch },
            { apiKey: 'test' },
            {
              fetchImpl: async () => {
                called = true;
                throw Error('should not request');
              },
            },
          ),
        );
        assert.equal(called, false);
      }
    }
});
test('last seen date filters include timestamps throughout the selected day', () => {
  const q = {
    ...baseQuery(),
    columns: ['device_id', 'last_seen'],
    filters: [{ field: 'last_seen', operator: 'equals', value: '2026-09-10' }],
  };
  assert.ok(
    compile(q).query.includes(
      "CAST(TRY_CAST(devices.last_seen AS TIMESTAMP) AS DATE) = '2026-09-10'",
    ),
  );
  const rows = [
    ['a', '2026-09-10T00:00:00Z'],
    ['b', '2026-09-10T23:59:59Z'],
    ['c', '2026-09-09T23:59:59Z'],
    ['d', null],
    ['e', 'invalid'],
  ].map(([device_id, last_seen]) => ({ device_id, last_seen, report_date: '2026-09-10' }));
  assert.deepEqual(
    evaluate(q, { devices: rows }).rows.map((r) => r[0]),
    ['a', 'b'],
  );
});
test('live detail results return null values plus warnings for unsupported fields', async () => {
  const q = { ...baseQuery(), source: 'groups', columns: ['group_id', 'region'] };
  const r = await executeDataTap(
    q,
    { apiKey: 'test' },
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          content: { id: 'q', status: 'SUCCEEDED', result: { data_array: [['g', null]] } },
        }),
      }),
    },
  );
  assert.equal(r.rows[0][1], null);
  assert.deepEqual(r.metadata.warnings, ['DataTap does not expose group region.']);
});
