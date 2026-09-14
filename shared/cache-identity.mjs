export const CACHE_VERSION = 'report-cache-v1';
export function canonicalQuery(q, preview = false) {
  const { type, date, from, to } = q.data_scope;
  const scope =
    type === 'LATEST' ? { type } : type === 'SNAPSHOT' ? { type, date } : { type, from, to };
  return stable({
    version: CACHE_VERSION,
    source: q.source,
    columns: q.columns,
    filters: q.filters,
    metrics: q.metrics.map(({ field, aggregation, alias }) => ({ field, aggregation, alias })),
    group_by: q.group_by,
    sort: q.sort,
    related: q.related || [],
    data_scope: scope,
    effective_limit: Math.min(q.limit || 1000, preview ? 100 : 10000),
    execution_mode: preview ? 'preview' : 'full',
  });
}
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stable(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function applyLabels(result, q) {
  return {
    ...result,
    columns: result.columns.map((c) => ({
      ...c,
      label: q.metrics.find((m) => m.alias === c.id)?.label || q.labels?.[c.id] || c.label,
    })),
  };
}
