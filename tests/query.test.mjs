import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate } from '../server/query.mjs';
import { baseQuery } from '../server/demo.mjs';
const fixture = {
  devices: [
    { device_id: 'a', name: 'Alpha', battery: 0, group_id: 'g', report_date: '2026-09-09' },
    { device_id: 'a', name: 'Alpha', battery: 30, group_id: 'g', report_date: '2026-09-10' },
    { device_id: 'b', name: 'Beta', battery: 60, group_id: 'g', report_date: '2026-09-10' },
    { device_id: 'c', name: null, battery: null, group_id: 'missing', report_date: '2026-09-10' },
  ],
  groups: [
    { group_id: 'g', group_name: 'Old name', report_date: '2026-09-09' },
    { group_id: 'g', group_name: 'New name', report_date: '2026-09-10' },
  ],
};
const query = (patch) => ({ ...baseQuery(), columns: ['device_id', 'name', 'battery'], ...patch });
test('serial uses hardware JSON in selections, filters, sorting and summaries', () => {
  const expression = "get_json_object(devices.hardware_info, '$.serial')";
  const sql = compile(
    query({
      columns: ['device_id', 'name', 'serial', 'os_version'],
      filters: [{ field: 'serial', operator: 'equals', value: "O'Brien" }],
      sort: [{ field: 'serial', direction: 'asc' }],
    }),
  ).query;
  assert.ok(sql.includes(expression));
  assert.ok(sql.includes(`WHERE ${expression} = 'O''Brien'`));
  assert.ok(sql.includes(`ORDER BY ${expression} ASC`));
  assert.ok(!sql.includes('devices.serial'));
  const grouped = compile(
    query({
      columns: [],
      group_by: ['serial'],
      metrics: [{ field: 'serial', aggregation: 'count_distinct', alias: 'total' }],
    }),
  ).query;
  assert.ok(grouped.includes(`COUNT(DISTINCT ${expression}) AS total`));
  assert.ok(grouped.includes(`GROUP BY ${expression}`));
});
test('latest scope excludes older snapshots and sets the DataTap flag', () => {
  const q = query({});
  assert.equal(compile(q).latest_data, true);
  assert.deepEqual(evaluate(q, fixture).rows, [
    ['a', 'Alpha', 30],
    ['b', 'Beta', 60],
    ['c', null, null],
  ]);
});
test('specific snapshots return only that date', () => {
  const q = query({ data_scope: { type: 'SNAPSHOT', date: '2026-09-09' } });
  assert.equal(compile(q).latest_data, false);
  assert.match(compile(q).query, /report_date = '2026-09-09'/);
  assert.deepEqual(evaluate(q, fixture).rows, [['a', 'Alpha', 0]]);
});
test('historical joins match group and snapshot, retaining unmatched left rows', () => {
  const q = query({
    data_scope: { type: 'DATE_RANGE', from: '2026-09-09', to: '2026-09-10' },
    related: ['groups'],
    columns: ['device_id', 'groups.group_name'],
  });
  assert.match(compile(q).query, /devices\.report_date = groups\.report_date/);
  assert.deepEqual(evaluate(q, fixture).rows, [
    ['a', 'Old name'],
    ['a', 'New name'],
    ['b', 'New name'],
    ['c', null],
  ]);
});
test('distinct count does not count a device twice across snapshots', () => {
  const q = query({
    data_scope: { type: 'DATE_RANGE', from: '2026-09-09', to: '2026-09-10' },
    metrics: [{ field: 'device_id', aggregation: 'count_distinct', alias: 'total' }],
  });
  assert.deepEqual(evaluate(q, fixture).rows, [[3]]);
});
test('aggregates ignore nulls and average includes zero', () => {
  const q = query({
    data_scope: { type: 'DATE_RANGE', from: '2026-09-09', to: '2026-09-10' },
    metrics: [
      { field: 'battery', aggregation: 'avg', alias: 'average' },
      { field: 'battery', aggregation: 'sum', alias: 'total' },
      { field: 'battery', aggregation: 'min', alias: 'minimum' },
    ],
  });
  assert.deepEqual(evaluate(q, fixture).rows, [[30, 90, 0]]);
});
test('unmatched aggregate returns count 0 and sum null', () => {
  const q = query({
    filters: [{ field: 'name', operator: 'equals', value: 'Unknown' }],
    metrics: [
      { field: 'device_id', aggregation: 'count', alias: 'count' },
      { field: 'battery', aggregation: 'sum', alias: 'total' },
    ],
  });
  assert.deepEqual(evaluate(q, fixture).rows, [[0, null]]);
});
test('filter literals and wildcard characters cannot change SQL meaning', () => {
  const q = query({
    filters: [{ field: 'name', operator: 'equals', value: "x'; DROP TABLE devices; --" }],
  });
  assert.match(compile(q).query, /x''; DROP TABLE devices; --/);
  const c = compile(query({ filters: [{ field: 'name', operator: 'contains', value: '10%_!' }] }));
  assert.match(c.query, /10!%!_!!/);
  assert.match(c.query, /ESCAPE '!'/);
});
test('raw SQL, arbitrary tables, identifiers, functions, directions are rejected', () => {
  for (const q of [
    query({ sql: 'SELECT * FROM users' }),
    query({ source: 'devices;DROP TABLE users' }),
    query({ columns: ['password'] }),
    query({ metrics: [{ field: 'name', aggregation: 'sleep', alias: 'metric' }] }),
    query({ sort: [{ field: 'name', direction: 'desc;DROP' }] }),
  ])
    assert.throws(() => compile(q));
});
test('invalid and inverted date scopes are rejected', () => {
  for (const data_scope of [
    { type: 'SNAPSHOT', date: '2026-02-30' },
    { type: 'DATE_RANGE', from: '2026-09-10', to: '2026-09-01' },
    { type: 'ALL' },
  ])
    assert.throws(() => compile(query({ data_scope })));
});
test('numeric functions and filter operators are checked against metadata', () => {
  assert.throws(() =>
    compile(query({ metrics: [{ field: 'name', aggregation: 'sum', alias: 'total' }] })),
  );
  assert.throws(() =>
    compile(query({ filters: [{ field: 'battery', operator: 'contains', value: '4' }] })),
  );
  assert.throws(() =>
    compile(query({ filters: [{ field: 'battery', operator: 'equals', value: 'NaN' }] })),
  );
});
test('range and membership filters handle typed values', () => {
  assert.deepEqual(
    evaluate(
      query({ filters: [{ field: 'battery', operator: 'between', value: ['20', '50'] }] }),
      fixture,
    ).rows,
    [['a', 'Alpha', 30]],
  );
  assert.deepEqual(
    evaluate(query({ filters: [{ field: 'name', operator: 'in', value: ['Beta'] }] }), fixture)
      .rows,
    [['b', 'Beta', 60]],
  );
});
test('explicit limits are capped for previews and normal execution', () => {
  assert.equal(compile(query({ limit: 50000 })).definition.limit, 10000);
  assert.equal(compile(query({ limit: 50000 }), true).definition.limit, 100);
  assert.throws(() => compile(query({ limit: -1 })));
  assert.throws(() => compile(query({ limit: 1.5 })));
});
test('multiple sorts have stable priority and results respect selected column order', () => {
  const r = evaluate(
    query({
      columns: ['battery', 'device_id'],
      sort: [
        { field: 'battery', direction: 'desc' },
        { field: 'device_id', direction: 'asc' },
      ],
      limit: 2,
    }),
    fixture,
  );
  assert.deepEqual(r.rows, [
    [60, 'b'],
    [30, 'a'],
  ]);
  assert.equal(r.metadata.truncated, true);
});
test('related dimension sorting uses a qualified identifier', () => {
  const q = query({
    columns: ['groups.group_name'],
    related: ['groups'],
    sort: [{ field: 'groups.group_name', direction: 'asc' }],
  });
  assert.match(compile(q).query, /ORDER BY groups\.group_name ASC/);
});

test('DataTap SQL uses validated bare identifiers instead of unsupported ANSI quoting', () => {
  const sql = compile(query({ columns: ['device_id'] })).query;
  assert.equal(sql, 'SELECT devices.device_id\nFROM devices\nLIMIT 1000;');
  assert.throws(() =>
    compile(
      query({
        metrics: [{ field: 'device_id', aggregation: 'count', alias: 'devices; DROP TABLE users' }],
      }),
    ),
  );
});
