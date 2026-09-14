import { CacheStatus, useCacheExpired } from './cache-status';
import { prepareChartData } from './chart-data.mjs';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  Search,
  ChevronDown,
  ArrowUpRight,
  Download,
  Table2,
  BarChart3,
  LoaderCircle,
  AlertCircle,
  Inbox,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  LabelList,
} from 'recharts';
import type { Result, VizDef } from './types';
import { fmt, exportCSV } from './api';
export const palette = ['#218575', '#69b6a2', '#a4cfc2', '#d0e6dd', '#86a9c3', '#bad1e0'];
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  title = 'No data matches these filters.',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <span>Loading report…</span>
      <div className="skeleton" />
      <div className="skeleton short" />
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error-state">
      <AlertCircle size={24} />
      <p>{error}</p>
      {retry && (
        <button className="btn small" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function DataTable({
  result,
  compact = false,
  pageSize,
}: {
  result: Result;
  compact?: boolean;
  pageSize?: number;
}) {
  const expired = useCacheExpired(result);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ index: number; desc: boolean } | null>(null);
  const size = pageSize ?? (compact ? 5 : 12);
  useEffect(() => setPage(0), [result, size]);
  if (expired)
    return (
      <>
        <CacheStatus result={result} />
        <Empty title="Cached data has expired. Refresh to load results." />
      </>
    );
  if (!result.rows.length)
    return (
      <>
        <CacheStatus result={result} />
        <Empty />
      </>
    );
  const rows = [...result.rows];
  if (sort)
    rows.sort(
      (a, b) =>
        (typeof a[sort.index] === 'number'
          ? a[sort.index] - b[sort.index]
          : String(a[sort.index]).localeCompare(String(b[sort.index]))) * (sort.desc ? -1 : 1),
    );
  return (
    <>
      {result.metadata.warnings?.map((warning) => (
        <p className="chart-data-note" key={warning}>
          {warning}
        </p>
      ))}
      <CacheStatus result={result} />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {result.columns.map((c, i) => (
                <th key={c.id}>
                  <button
                    onClick={() =>
                      setSort({ index: i, desc: sort?.index === i ? !sort.desc : false })
                    }
                  >
                    {c.label}
                    {sort?.index === i ? (
                      <span>{sort.desc ? '↓' : '↑'}</span>
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * size, page * size + size).map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>
                    {result.columns[j].id === 'status' ? (
                      <span className={'status ' + String(v).toLowerCase()}>
                        <i />
                        {v}
                      </span>
                    ) : result.columns[j].id === 'battery' ? (
                      <span className="battery">
                        <i
                          style={{
                            width: Math.max(2, Number(v) * 0.28),
                            background: Number(v) < 30 ? '#da974f' : '#52a591',
                          }}
                        />
                        {v}%
                      </span>
                    ) : (
                      fmt(v)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {page * size + 1}–{Math.min((page + 1) * size, rows.length)} of {fmt(rows.length)} rows
          {result.metadata.truncated || result.metadata.limit_reached ? ' · Row limit reached' : ''}
        </span>
        <div>
          <button
            className="icon-btn"
            aria-label="Previous page"
            disabled={!page}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-btn"
            aria-label="Next page"
            disabled={(page + 1) * size >= rows.length}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
export function Chart({
  result,
  config,
  height = 250,
}: {
  result: Result;
  config: VizDef;
  height?: number;
}) {
  const expired = useCacheExpired(result);
  if (expired)
    return (
      <>
        <CacheStatus result={result} />
        <Empty title="Cached data has expired. Refresh to load results." />
      </>
    );
  if (!result.rows.length)
    return (
      <>
        <CacheStatus result={result} />
        <Empty />
      </>
    );
  const dimension = config.dimension || result.columns[0]?.id;
  const measures = config.measures.filter((m) => result.columns.some((c) => c.id === m));
  if (!measures.length && config.type !== 'table')
    return <ErrorState error="This graph requires a numeric measure." />;
  if (config.type === 'table') return <DataTable result={result} />;
  const sourceData = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((c, i) => [c.id, row[i]])),
  );
  const categorical = ['bar', 'horizontal_bar', 'stacked_bar', 'pie', 'donut'].includes(
    config.type,
  );
  const { data, combined } = categorical
    ? prepareChartData(sourceData, dimension, measures, config.options.categoryLimit)
    : { data: sourceData, combined: 0 };
  const partial = !!(result.metadata.truncated || result.metadata.limit_reached);
  const note = (
    <>
      <CacheStatus result={result} />
      {result.metadata.warnings?.map((warning) => (
        <p className="chart-data-note" key={warning}>
          {warning}
        </p>
      ))}
      {combined > 0 && (
        <p className="chart-data-note">
          Largest {data.length - 1} categories shown; {combined} combined as Other. All returned
          values are included.
        </p>
      )}
      {partial && (
        <p className="chart-data-note">
          Row limit reached. This chart may show only part of the report; run with a higher limit
          for complete totals.
        </p>
      )}
    </>
  );
  const label = (id: string) => result.columns.find((c) => c.id === id)?.label || id;
  if (config.type === 'kpi')
    return (
      <div className="single-kpi">
        {fmt(data[0]?.[measures[0]])}
        <span>{label(measures[0])}</span>
        {note}
      </div>
    );
  if (config.type === 'pie' || config.type === 'donut')
    return (
      <div>
        {note}
        <div className="donut-layout">
          <div className="donut-chart">
            <ResponsiveContainer width="100%" height={height}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey={measures[0]}
                  nameKey={dimension}
                  innerRadius={config.type === 'donut' ? '66%' : 0}
                  outerRadius="87%"
                  paddingAngle={config.type === 'donut' ? 3 : 1}
                  stroke="none"
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={palette[i % palette.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            {config.type === 'donut' && (
              <div className="donut-center">
                <strong>{fmt(data.reduce((s, r) => s + Number(r[measures[0]] || 0), 0))}</strong>
                <span>
                  {partial ? 'Shown ' : 'Total '}
                  {label(measures[0]).toLowerCase()}
                </span>
              </div>
            )}
          </div>
          {config.options.legend && (
            <div className="chart-legend">
              {data.map((r, i) => (
                <div key={i}>
                  <i style={{ background: palette[i % palette.length] }} />
                  <span>{r[dimension]}</span>
                  <strong>{fmt(r[measures[0]])}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  const axis = { axisLine: false, tickLine: false, tick: { fill: '#7a8290', fontSize: 12 } };
  const grid = config.options.grid ? (
    <CartesianGrid vertical={false} stroke="#eef0f3" strokeDasharray="3 3" />
  ) : null;
  const tip = (
    <Tooltip
      contentStyle={tooltipStyle}
      formatter={(v, n) => [fmt(v), label(String(n))]}
      cursor={{ fill: '#f2f7f5' }}
    />
  );
  const legend = config.options.legend && measures.length > 1 ? <Legend formatter={label} /> : null;
  return (
    <div>
      {note}
      <ResponsiveContainer width="100%" height={height}>
        {config.type === 'line' ? (
          <LineChart data={data} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey={dimension}
              {...axis}
              tickFormatter={(v) =>
                result.columns.find((c) => c.id === dimension)?.type === 'date'
                  ? String(v).slice(5)
                  : v
              }
            />
            <YAxis {...axis} />
            {tip}
            {legend}
            {measures.map((m, i) => (
              <Line
                key={m}
                type="monotone"
                dataKey={m}
                stroke={palette[i]}
                strokeWidth={3}
                dot={false}
              />
            ))}
          </LineChart>
        ) : config.type === 'area' ? (
          <AreaChart data={data} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#218575" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#218575" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {grid}
            <XAxis dataKey={dimension} {...axis} tickFormatter={(v) => String(v).slice(5)} />
            <YAxis {...axis} />
            {tip}
            {legend}
            {measures.map((m, i) => (
              <Area
                key={m}
                type="monotone"
                dataKey={m}
                stroke={palette[i]}
                strokeWidth={2.5}
                fill="url(#areaFill)"
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart
            data={data}
            layout={config.type === 'horizontal_bar' ? 'vertical' : 'horizontal'}
            margin={{
              top: 20,
              right: 15,
              left: config.type === 'horizontal_bar' ? 30 : -15,
              bottom: 0,
            }}
            barCategoryGap="28%"
          >
            {grid}
            <XAxis
              {...axis}
              type={config.type === 'horizontal_bar' ? 'number' : 'category'}
              dataKey={config.type === 'horizontal_bar' ? undefined : dimension}
            />
            <YAxis
              {...axis}
              type={config.type === 'horizontal_bar' ? 'category' : 'number'}
              dataKey={config.type === 'horizontal_bar' ? dimension : undefined}
            />
            {tip}
            {legend}
            {measures.map((m, i) => (
              <Bar
                key={m}
                dataKey={m}
                fill={palette[i]}
                radius={[4, 4, 0, 0]}
                maxBarSize={75}
                stackId={config.type === 'stacked_bar' ? 'stack' : undefined}
              >
                {measures.length === 1 &&
                  data.map((_, j) => <Cell key={j} fill={palette[j % palette.length]} />)}
                {config.options.values && <LabelList dataKey={m} position="top" fontSize={12} />}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
const tooltipStyle = {
  border: '1px solid #e6e9ed',
  borderRadius: 8,
  fontSize: 13,
  boxShadow: '0 5px 20px #17233112',
};
export function ResultView({
  result,
  name,
  config,
  compact = false,
}: {
  result: Result;
  name: string;
  config?: VizDef;
  compact?: boolean;
}) {
  const [table, setTable] = useState(!config || config.type === 'table');
  return (
    <>
      <div className="result-toolbar">
        <div className="segmented">
          <button className={table ? 'active' : ''} onClick={() => setTable(true)}>
            <Table2 size={15} />
            Table
          </button>
          {config && (
            <button className={!table ? 'active' : ''} onClick={() => setTable(false)}>
              <BarChart3 size={15} />
              Visualization
            </button>
          )}
        </div>
        <button className="btn small" onClick={() => exportCSV(result, name)}>
          <Download size={14} />
          Export CSV
        </button>
      </div>
      {table ? (
        <DataTable result={result} compact={compact} />
      ) : (
        <Chart result={result} config={config!} />
      )}
    </>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
