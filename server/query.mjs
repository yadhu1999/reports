import { connectivityStatus } from './connectivity.mjs';
import { liveExpressions } from './live-fields.mjs';
import { expandStatistics } from './statistics-fields.mjs';
import { dataset, fieldsFor, operators, aggregateOptions } from './catalog.mjs';
const quote = (v) => `'${String(v).replaceAll("'", "''")}'`;
// Only catalog identifiers and validated metric aliases reach SQL. DataTap rejects
// ANSI double-quoted identifiers, so use its supported bare identifier syntax.
const ident = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw Error('Invalid query identifier.');
  return value;
};
const validDate = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function validate(q, preview = false) {
  if (!q || typeof q !== 'object' || 'sql' in q || 'query' in q)
    throw Error('Submit a report definition, not SQL.');
  const fields = fieldsFor(q);
  const lookup = (id) => {
    const f = fields.find((f) => f.id === id);
    if (!f) throw Error('The selected field is no longer available.');
    return f;
  };
  if (!['LATEST', 'SNAPSHOT', 'DATE_RANGE'].includes(q.data_scope?.type))
    throw Error('Choose a data scope.');
  if (q.data_scope.type === 'SNAPSHOT' && !validDate(q.data_scope.date))
    throw Error('Choose a valid snapshot date.');
  if (
    q.data_scope.type === 'DATE_RANGE' &&
    (!validDate(q.data_scope.from) ||
      !validDate(q.data_scope.to) ||
      q.data_scope.from > q.data_scope.to)
  )
    throw Error('Choose a valid historical range.');
  if (
    !Array.isArray(q.columns) ||
    !Array.isArray(q.filters) ||
    !Array.isArray(q.sort) ||
    !Array.isArray(q.group_by) ||
    !Array.isArray(q.metrics)
  )
    throw Error('Invalid report definition.');
  if (
    q.columns.length > 50 ||
    q.filters.length > 30 ||
    q.metrics.length > 10 ||
    q.group_by.length > 5 ||
    q.sort.length > 10
  )
    throw Error('This report exceeds configuration limits.');
  q.columns.forEach(lookup);
  q.group_by.forEach(lookup);
  const seen = new Set(q.group_by);
  q.metrics.forEach((m) => {
    if (!aggregateOptions(lookup(m.field).type).includes(m.aggregation))
      throw Error('This aggregation is not compatible with the field.');
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(m.alias) || seen.has(m.alias))
      throw Error('Metrics need unique alphanumeric identifiers.');
    seen.add(m.alias);
  });
  if (!q.metrics.length && !q.columns.length) throw Error('Choose at least one column.');
  if (q.group_by.length && !q.metrics.length) throw Error('Add a metric to summarize data.');
  const scalar = (f, v) => {
    if (v == null || typeof v === 'object' || typeof v === 'function')
      throw Error('Enter a filter value.');
    if (f.type === 'number' && (v === '' || !Number.isFinite(Number(v))))
      throw Error('Enter a numeric filter value.');
    if (f.type === 'date' && !validDate(v)) throw Error('Enter a date in YYYY-MM-DD format.');
  };
  q.filters.forEach((f) => {
    const field = lookup(f.field);
    if (!operators[field.type].includes(f.operator))
      throw Error('This filter is not compatible with the field.');
    if (!['is_empty', 'is_not_empty'].includes(f.operator)) {
      if (['between', 'in', 'not_in'].includes(f.operator)) {
        if (
          !Array.isArray(f.value) ||
          !f.value.length ||
          f.value.length > 100 ||
          (f.operator === 'between' && f.value.length !== 2)
        )
          throw Error('Enter the required filter values.');
        f.value.forEach((v) => scalar(field, v));
      } else scalar(field, f.value);
    }
  });
  const output = q.metrics.length ? [...q.group_by, ...q.metrics.map((m) => m.alias)] : q.columns;
  q.sort.forEach((s) => {
    if (!output.includes(s.field) || !['asc', 'desc'].includes(s.direction))
      throw Error('Sort by a selected output field.');
  });
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1))
    throw Error('The row limit must be a positive integer.');
  return { ...q, limit: Math.min(q.limit || 1000, preview ? 100 : 10000) };
}
export function compile(input, preview = false) {
  const q = validate(input, preview),
    fields = fieldsFor(q);
  const col = (id) =>
    Object.hasOwn(liveExpressions[q.source] || {}, id)
      ? liveExpressions[q.source][id]
      : id.includes('.')
        ? id.split('.').map(ident).join('.')
        : `${ident(q.source)}.${ident(id)}`;
  const value = (id, v) =>
    fields.find((f) => f.id === id)?.type === 'number' ? String(Number(v)) : quote(v);
  const where = q.filters.map((f) => {
    const c =
        q.source === 'devices' && f.field === 'last_seen'
          ? `CAST(TRY_CAST(${col(f.field)} AS TIMESTAMP) AS DATE)`
          : col(f.field),
      v = f.value;
    const map = {
      equals: '=',
      not_equals: '<>',
      greater_than: '>',
      greater_or_equal: '>=',
      less_than: '<',
      less_or_equal: '<=',
      before: '<',
      after: '>',
    };
    if (map[f.operator]) return `${c} ${map[f.operator]} ${value(f.field, v)}`;
    if (f.operator === 'is_empty')
      return `(${c} IS NULL${fields.find((x) => x.id === f.field).type === 'string' ? ` OR ${c} = ''` : ''})`;
    if (f.operator === 'is_not_empty')
      return `(${c} IS NOT NULL${fields.find((x) => x.id === f.field).type === 'string' ? ` AND ${c} <> ''` : ''})`;
    if (f.operator === 'between')
      return `${c} BETWEEN ${value(f.field, v[0])} AND ${value(f.field, v[1])}`;
    if (['in', 'not_in'].includes(f.operator))
      return `${c} ${f.operator === 'in' ? 'IN' : 'NOT IN'} (${v.map((x) => value(f.field, x)).join(', ')})`;
    const escaped = String(v).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
    return `${c} ${f.operator === 'not_contains' ? 'NOT LIKE' : 'LIKE'} ${quote((f.operator === 'ends_with' || f.operator.includes('contains') ? '%' : '') + escaped + (f.operator === 'starts_with' || f.operator.includes('contains') ? '%' : ''))} ESCAPE '!'`;
  });
  if (q.data_scope.type === 'SNAPSHOT')
    where.push(`${col('report_date')} = ${quote(q.data_scope.date)}`);
  if (q.data_scope.type === 'DATE_RANGE')
    where.push(
      `${col('report_date')} BETWEEN ${quote(q.data_scope.from)} AND ${quote(q.data_scope.to)}`,
    );
  const selections = q.metrics.length
    ? [
        ...q.group_by.map(col),
        ...q.metrics.map(
          (m) =>
            `${m.aggregation === 'count_distinct' ? 'COUNT(DISTINCT ' : m.aggregation.toUpperCase() + '('}${col(m.field)}) AS ${ident(m.alias)}`,
        ),
      ]
    : q.columns.map(col);
  const joins = (q.related || []).map((id) => {
    const r = dataset(q.source).relationships.find((r) => r.id === id);
    return `LEFT JOIN ${ident(id)} ON ${col(r.left)} = ${ident(id)}.${ident(r.right)}${q.data_scope.type !== 'LATEST' ? ` AND ${col('report_date')} = ${ident(id)}.report_date` : ''}`;
  });
  return {
    definition: q,
    query: `SELECT ${selections.join(', ')}\nFROM ${ident(q.source)}${joins.length ? '\n' + joins.join('\n') : ''}${where.length ? '\nWHERE ' + where.join(' AND ') : ''}${q.group_by.length ? '\nGROUP BY ' + q.group_by.map(col).join(', ') : ''}${q.sort.length ? '\nORDER BY ' + q.sort.map((s) => `${q.metrics.some((m) => m.alias === s.field) ? ident(s.field) : col(s.field)} ${s.direction.toUpperCase()}`).join(', ') : ''}\nLIMIT ${q.limit};`,
    latest_data: q.data_scope.type === 'LATEST',
  };
}
export function resultColumns(q) {
  const fs = fieldsFor(q);
  return [
    ...(q.metrics.length ? q.group_by : q.columns).map((id) => ({
      ...fs.find((f) => f.id === id),
      label: q.labels?.[id] || fs.find((f) => f.id === id).label,
    })),
    ...q.metrics.map((m) => ({
      id: m.alias,
      label: m.label || m.alias,
      type: ['count', 'count_distinct', 'sum', 'avg'].includes(m.aggregation)
        ? 'number'
        : fs.find((f) => f.id === m.field).type,
    })),
  ];
}
export function evaluate(input, data, preview = false) {
  const q = validate(input, preview);
  let rows = data[q.source];
  if (q.source === 'device_stats') rows = rows.map(expandStatistics);
  if (q.source === 'devices')
    rows = rows.map((row) => ({
      ...row,
      status: connectivityStatus(row.last_seen, row.report_generation_timestamp),
    }));
  const last = rows.reduce((a, r) => (r.report_date > a ? r.report_date : a), '');
  rows = rows.filter((r) =>
    q.data_scope.type === 'LATEST'
      ? r.report_date === last
      : q.data_scope.type === 'SNAPSHOT'
        ? r.report_date === q.data_scope.date
        : r.report_date >= q.data_scope.from && r.report_date <= q.data_scope.to,
  );
  if (q.related?.includes('groups'))
    rows = rows.map((r) => ({
      ...r,
      'groups.group_name':
        data.groups.find((g) => g.group_id === r.group_id && g.report_date === r.report_date)
          ?.group_name ?? null,
    }));
  const types = Object.fromEntries(fieldsFor(q).map((f) => [f.id, f.type]));
  rows = rows.filter((r) =>
    q.filters.every((f) => {
      const raw = r[f.field],
        a =
          q.source === 'devices' && f.field === 'last_seen'
            ? Number.isNaN(Date.parse(raw)) || raw == null
              ? null
              : new Date(raw).toISOString().slice(0, 10)
            : raw,
        v =
          types[f.field] === 'number'
            ? Array.isArray(f.value)
              ? f.value.map(Number)
              : Number(f.value)
            : f.value;
      switch (f.operator) {
        case 'equals':
          return a === v;
        case 'not_equals':
          return a != null && a !== v;
        case 'contains':
          return a != null && String(a).includes(v);
        case 'not_contains':
          return a != null && !String(a).includes(v);
        case 'starts_with':
          return a != null && String(a).startsWith(v);
        case 'ends_with':
          return a != null && String(a).endsWith(v);
        case 'is_empty':
          return a == null || a === '';
        case 'is_not_empty':
          return a != null && a !== '';
        case 'in':
          return v.includes(a);
        case 'not_in':
          return a != null && !v.includes(a);
        case 'greater_than':
        case 'after':
          return a != null && a > v;
        case 'greater_or_equal':
          return a != null && a >= v;
        case 'less_than':
        case 'before':
          return a != null && a < v;
        case 'less_or_equal':
          return a != null && a <= v;
        case 'between':
          return a != null && a >= v[0] && a <= v[1];
        default:
          return false;
      }
    }),
  );
  if (q.metrics.length) {
    const buckets = new Map();
    if (!q.group_by.length) buckets.set('[]', []);
    for (const r of rows) {
      const key = JSON.stringify(q.group_by.map((f) => r[f]));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    rows = [...buckets].map(([k, rs]) => {
      const out = Object.fromEntries(q.group_by.map((f, i) => [f, JSON.parse(k)[i]]));
      for (const m of q.metrics) {
        const vs = rs.map((r) => r[m.field]).filter((v) => v != null);
        out[m.alias] =
          m.aggregation === 'count'
            ? vs.length
            : m.aggregation === 'count_distinct'
              ? new Set(vs).size
              : !vs.length
                ? null
                : m.aggregation === 'sum'
                  ? vs.reduce((a, b) => a + b, 0)
                  : m.aggregation === 'avg'
                    ? vs.reduce((a, b) => a + b, 0) / vs.length
                    : m.aggregation === 'min'
                      ? vs.reduce((a, b) => (a < b ? a : b))
                      : vs.reduce((a, b) => (a > b ? a : b));
      }
      return out;
    });
  }
  rows.sort((a, b) => {
    for (const s of q.sort) {
      const x = a[s.field],
        y = b[s.field];
      const c = typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      if (c) return c * (s.direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
  const columns = resultColumns(q),
    total = rows.length;
  return {
    columns,
    rows: rows.slice(0, q.limit).map((r) => columns.map((c) => r[c.id] ?? null)),
    metadata: {
      row_count: Math.min(total, q.limit),
      truncated: total > q.limit,
      executed_at: new Date().toISOString(),
      mode: 'demo',
    },
  };
}
