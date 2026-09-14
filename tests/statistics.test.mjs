import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../server/query.mjs';
import { baseQuery } from '../server/demo.mjs';

test('saved statistics reports compile against live columns and preserve missing CPU values', () => {
  const sql = compile({
    ...baseQuery(),
    source: 'device_stats',
    columns: ['device_id', 'battery', 'storage_used', 'cpu_usage'],
    filters: [{ field: 'battery', operator: 'greater_than', value: 20 }],
    sort: [{ field: 'storage_used', direction: 'desc' }],
  }).query;
  assert.ok(sql.includes('TRY_CAST(device_stats.battery_level AS DOUBLE)'));
  assert.ok(sql.includes("get_json_object(device_stats.memory_stats, '$.units') = 'BYTE'"));
  assert.ok(sql.includes('$.total_internal_storage'));
  assert.ok(sql.includes('$.available_internal_storage'));
  assert.ok(sql.includes('/ 1000000000.0 ELSE NULL END'));
  assert.ok(sql.includes('CAST(NULL AS DOUBLE)'));
  assert.match(
    sql,
    /WHERE COALESCE\(TRY_CAST\(device_stats.battery_level AS DOUBLE\), TRY_CAST\(get_json_object\(device_stats.battery_stats, '\$\.battery_level'\) AS DOUBLE\)\) > 20/,
  );
  assert.ok(!/device_stats\.(battery\b|storage_used|cpu_usage)/.test(sql));
});

test('flattened JSON fields extract scalar values, preserve zero, and handle missing or invalid payloads', async () => {
  const { expandStatistics } = await import('../server/statistics-fields.mjs');
  const row = expandStatistics({
    memory_stats: '{"units":"BYTE","total_memory":1000}',
    network_stats:
      '{"cellular_network_info":{"numberOfSim":0,"networkOperator":"Example"},"wifi_network_info":{"wifi_ssid":"Example Wi-Fi"}}',
    battery_stats: '{"battery_level":0,"battery_temperature":"invalid"}',
    location_stats: '{"latitude":0,"longitude":-10}',
  });
  assert.equal(row.cellular_sim_count, 0);
  assert.equal(row.cellular_operator, 'Example');
  assert.equal(row.battery, 0);
  assert.equal(row.wifi_ssid, 'Example Wi-Fi');
  assert.equal(row.latitude, 0);
  assert.equal(row.memory_total_memory, '1000');
  assert.equal(row.battery_temperature, null);
  assert.equal(expandStatistics({ network_stats: 'invalid' }).cellular_operator, null);
  assert.equal(expandStatistics({ network_stats: null }).cellular_sim_count, null);
});
test('flattened numeric fields work in SQL filters and aggregates through allowlisted JSON paths', () => {
  const q = {
    ...baseQuery(),
    source: 'device_stats',
    columns: [],
    group_by: ['cellular_operator'],
    metrics: [{ field: 'cellular_sim_count', aggregation: 'sum', alias: 'sims' }],
    filters: [{ field: 'cellular_sim_count', operator: 'greater_than', value: 0 }],
  };
  const sql = compile(q).query;
  assert.ok(
    sql.includes(
      "SUM(TRY_CAST(get_json_object(device_stats.network_stats, '$.cellular_network_info.numberOfSim') AS DOUBLE)) AS sims",
    ),
  );
  assert.ok(
    sql.includes(
      "GROUP BY get_json_object(device_stats.network_stats, '$.cellular_network_info.networkOperator')",
    ),
  );
});
