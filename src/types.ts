export type Field = {
  legacy?: boolean;
  id: string;
  label: string;
  type: string;
  category: string;
  description: string;
};
export type Dataset = {
  id: string;
  label: string;
  description: string;
  fields: Field[];
  relationships?: { id: string; label: string; fields: Field[] }[];
};
export type Query = {
  source: string;
  data_scope: { type: string; date?: string; from?: string; to?: string };
  columns: string[];
  filters: { field: string; operator: string; value: any }[];
  group_by: string[];
  metrics: { field: string; aggregation: string; alias: string; label: string }[];
  sort: { field: string; direction: string }[];
  related: string[];
  labels: Record<string, string>;
  limit: number;
};
export type Report = {
  id: string;
  name: string;
  description: string;
  query_definition: Query;
  created_by: string;
  updated_at: string;
  last_executed_at?: string;
  favorite?: boolean;
};
export type VizDef = {
  type: string;
  dimension?: string;
  measures: string[];
  series?: string;
  options: { legend?: boolean; values?: boolean; grid?: boolean; categoryLimit?: number };
};
export type Viz = {
  id: string;
  name: string;
  description?: string;
  report_id: string;
  visualization_definition: VizDef;
  updated_at: string;
  created_by: string;
};
export type Widget = {
  id: string;
  type: 'report' | 'visualization';
  resource_id: string;
  layout: { width: number; height: number };
};
export type Dashboard = {
  id: string;
  name: string;
  description: string;
  widgets: Widget[];
  favorite?: boolean;
  updated_at: string;
  created_by: string;
};
export type CacheInfo = {
  namespace: string;
  key: string;
  source: string;
  state: string;
  browser_cache_allowed?: boolean;
  persist_allowed?: boolean;
  fetched_at?: string;
  expires_at?: string;
  stale_until?: string;
  refresh_execution_id?: string | null;
  retry_not_before?: string | null;
  refresh_error?: string;
};
export type Result = {
  cache?: CacheInfo;
  execution_id: string;
  status: string;
  columns: Field[];
  rows: any[][];
  metadata: {
    row_count: number;
    executed_at: string;
    truncated?: boolean;
    limit_reached?: boolean;
    mode: string;
    warnings?: string[];
  };
  error?: string;
  query?: string;
};
export type User = { tenant?: string; id: string; name: string; email: string; role: string };
