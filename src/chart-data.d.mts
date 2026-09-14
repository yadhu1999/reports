export function prepareChartData(
  rows: Record<string, any>[],
  dimension: string,
  measures: string[],
  categoryLimit?: number,
): { data: Record<string, any>[]; combined: number };
