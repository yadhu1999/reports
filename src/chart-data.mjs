// Presentation-only bucketing. Underlying table rows and exports remain untouched.
export function prepareChartData(rows, dimension, measures, categoryLimit = 0) {
  const data = rows.map((row) => ({
    ...row,
    [dimension]:
      row[dimension] == null
        ? 'Not reported'
        : String(row[dimension]).trim() === ''
          ? 'Empty value'
          : row[dimension],
  }));
  if (categoryLimit < 2 || data.length <= categoryLimit) return { data, combined: 0 };
  const ordered = [...data].sort(
    (a, b) => Number(b[measures[0]] || 0) - Number(a[measures[0]] || 0),
  );
  const shown = ordered.slice(0, categoryLimit - 1),
    rest = ordered.slice(categoryLimit - 1);
  const other = { [dimension]: `Other (${rest.length} categories)` };
  for (const m of measures) other[m] = rest.reduce((sum, row) => sum + Number(row[m] || 0), 0);
  return { data: [...shown, other], combined: rest.length };
}
