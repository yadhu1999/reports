import { useCacheView } from './cache-status';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  Database,
  Download,
  Filter,
  GripVertical,
  Info,
  LineChart,
  Link2,
  ListFilter,
  Maximize2,
  PieChart,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  Table2,
  TrendingUp,
  X,
} from 'lucide-react';
import { api, exportCSV, fmt, run } from './api';
import type { Dashboard, Dataset, Field, Query, Report, Result, Viz, VizDef } from './types';
import { Chart, DataTable, Empty, ErrorState, Loading, Modal, SearchBox } from './components';
type Props = {
  report: Report;
  visualization?: Viz;
  datasets: Dataset[];
  metadata: any;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (r: Report, v?: Viz) => Promise<void>;
  dashboards: Dashboard[];
  notify: (s: string) => void;
};
const chartTypes = [
  ['table', 'Table', Table2],
  ['bar', 'Bar', BarChart3],
  ['horizontal_bar', 'Horizontal', ListFilter],
  ['stacked_bar', 'Stacked', BarChart3],
  ['line', 'Line', LineChart],
  ['area', 'Area', TrendingUp],
  ['pie', 'Pie', PieChart],
  ['donut', 'Donut', PieChart],
  ['kpi', 'KPI', Maximize2],
] as const;
export default function ReportBuilder({
  report,
  visualization,
  datasets,
  metadata,
  canEdit,
  onClose,
  onSaved,
  dashboards,
  notify,
}: Props) {
  const [q, setQ] = useState<Query>(structuredClone(report.query_definition));
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(visualization ? 'visualization' : 'table');
  const [config, setConfig] = useState<VizDef>(
    visualization?.visualization_definition || {
      type: report.query_definition.group_by.length ? 'bar' : 'kpi',
      dimension: report.query_definition.group_by[0],
      measures: report.query_definition.metrics.map((m) => m.alias),
      options: { legend: true, grid: true, values: false },
    },
  );
  const [saveModal, setSaveModal] = useState(false);
  const [saveViz, setSaveViz] = useState(!!visualization);
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [addDashboard, setAddDashboard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [manualRun, setManualRun] = useState(0);
  const wake = useCacheView(setResult);
  const manualSeen = useRef(manualRun);
  const lastRunQuery = useRef<Query | null>(null);
  const [preview, setPreview] = useState(true);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const dataset = datasets.find((d) => d.id === q.source)!;
  const fields = [
    ...dataset.fields,
    ...(q.related || []).flatMap(
      (id) => dataset.relationships?.find((r) => r.id === id)?.fields || [],
    ),
  ].filter(
    (f) =>
      !f.legacy ||
      [
        ...q.columns,
        ...q.group_by,
        ...q.filters.map((x) => x.field),
        ...q.metrics.map((x) => x.field),
      ].includes(f.id),
  );
  const field = (id: string) => fields.find((f) => f.id === id);
  const summary = q.metrics.length > 0;
  const put = (patch: Partial<Query>) => {
    setQ((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setPreview(true);
  };
  const setViz = (patch: Partial<VizDef>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  useEffect(() => {
    if (dirty && manualSeen.current === manualRun) {
      setResult(null);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      const force = manualSeen.current !== manualRun && lastRunQuery.current === q;
      lastRunQuery.current = q;
      manualSeen.current = manualRun;
      run(q, preview, controller.signal, force, (r) => {
        if (!controller.signal.aborted) {
          setResult(r);
          setLoading(false);
        }
      })
        .then((r) => {
          if (!controller.signal.aborted) {
            setResult(r);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.message);
            setLoading(false);
          }
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, manualRun, wake]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const outputs = summary
    ? [
        ...q.group_by.map((id) => ({ id, label: q.labels?.[id] || field(id)?.label || id })),
        ...q.metrics.map((m) => ({ id: m.alias, label: m.label })),
      ]
    : q.columns.map((id) => ({ id, label: q.labels?.[id] || field(id)?.label || id }));
  function compatibility(type: string) {
    if (type === 'table') return '';
    if (
      !q.metrics.some(
        (m) =>
          ['count', 'count_distinct', 'sum', 'avg'].includes(m.aggregation) ||
          field(m.field)?.type === 'number',
      )
    )
      return 'Requires a numeric summary metric.';
    if (type === 'kpi')
      return q.group_by.length || q.metrics.length !== 1
        ? 'Requires one metric and no grouping.'
        : '';
    if (!q.group_by.length) return 'Add a grouping dimension.';
    if (['pie', 'donut'].includes(type) && (q.group_by.length !== 1 || q.metrics.length !== 1))
      return 'Requires one dimension and one metric.';
    if (
      ['line', 'area'].includes(type) &&
      !['date', 'number'].includes(field(config.dimension || q.group_by[0])?.type || '')
    )
      return 'Requires a date or numeric dimension.';
    return '';
  }
  const selectField = (id: string) => {
    if (summary)
      put({
        group_by: q.group_by.includes(id)
          ? q.group_by.filter((x) => x !== id)
          : [...q.group_by, id],
        sort: [],
      });
    else
      put({
        columns: q.columns.includes(id) ? q.columns.filter((x) => x !== id) : [...q.columns, id],
        sort: [],
      });
  };
  const move = (from: number, to: number) => {
    const list = [...q.columns];
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    put({ columns: list });
  };
  const defaultMetric = () => ({
    field: fields[0].id,
    aggregation: 'count_distinct',
    alias: 'metric_' + crypto.randomUUID().slice(0, 8),
    label: 'Count of ' + fields[0].label,
  });
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const saved = await api<Report>(
        '/reports' + (report.id ? '/' + report.id : ''),
        report.id ? 'PUT' : 'POST',
        {
          ...report,
          name: values.get('name'),
          description: values.get('description'),
          query_definition: q,
        },
      );
      let viz: Viz | undefined;
      if (saveViz) {
        const v = {
          name: values.get('viz_name') || values.get('name'),
          report_id: saved.id,
          visualization_definition: {
            ...config,
            dimension: config.dimension || q.group_by[0],
            measures: config.measures.filter((id) => q.metrics.some((m) => m.alias === id)).length
              ? config.measures
              : q.metrics.map((m) => m.alias),
          },
        };
        viz = await api<Viz>(
          '/visualizations' + (visualization ? '/' + visualization.id : ''),
          visualization ? 'PUT' : 'POST',
          v,
        );
      }
      setDirty(false);
      setSaveModal(false);
      await onSaved(saved, viz);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const effectiveConfig = {
    ...config,
    dimension: q.group_by.includes(config.dimension || '') ? config.dimension : q.group_by[0],
    measures: config.measures.filter((id) => q.metrics.some((m) => m.alias === id)).length
      ? config.measures
      : q.metrics.map((m) => m.alias),
  };
  async function exportPNG() {
    const svg = chartRef.current?.querySelector('svg.recharts-surface') as SVGSVGElement | null;
    if (!svg) {
      notify('Select a chart to export as PNG.');
      return;
    }
    const { width, height } = svg.getBoundingClientRect();
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    const source = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
    );
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = report.name + '.png';
      a.click();
      URL.revokeObjectURL(source);
    };
    img.onerror = () => {
      URL.revokeObjectURL(source);
      notify('Unable to export this chart.');
    };
    img.src = source;
  }
  return (
    <div className="report-builder">
      <div className="builder-header">
        <button
          className="icon-btn"
          aria-label="Back to reports"
          onClick={() => (dirty ? setDiscard(true) : onClose())}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="builder-breadcrumb">REPORT BUILDER</div>
          <h1>
            {report.name}
            {dirty && <span className="unsaved-dot" title="Unsaved changes" />}
          </h1>
        </div>
        <div className="builder-actions">
          <button
            className="btn"
            title="Inspect the generated SQL"
            onClick={() => setAdvanced(true)}
          >
            <Braces size={16} />
            <span>View query</span>
          </button>
          {canEdit && report.id && (
            <button
              className="btn"
              disabled={dirty}
              title={dirty ? 'Save your changes first' : 'Add saved report to dashboard'}
              onClick={() => setAddDashboard(true)}
            >
              <Plus size={16} />
              <span>Add to dashboard</span>
            </button>
          )}
          {canEdit && (
            <button className="btn" onClick={() => setSaveModal(true)}>
              <Save size={15} />
              Save
            </button>
          )}
          <button
            className="btn primary"
            onClick={() => {
              setPreview(false);
              setManualRun((n) => n + 1);
            }}
            disabled={loading}
          >
            <Play size={15} />
            {loading ? 'Running…' : 'Run report'}
          </button>
        </div>
      </div>
      <div className="builder-scope">
        <span>
          <Database size={15} />
          <strong>{dataset.label}</strong>
        </span>
        <span className="scope-separator" />
        <select
          aria-label="Data scope"
          disabled={!canEdit}
          value={q.data_scope.type}
          onChange={(e) => {
            const today = new Date().toISOString().slice(0, 10);
            put({
              data_scope: {
                type: e.target.value,
                date: today,
                from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
                to: today,
              },
            });
          }}
        >
          <option value="LATEST">Latest snapshot</option>
          <option value="SNAPSHOT">Specific snapshot</option>
          <option value="DATE_RANGE">Historical range</option>
        </select>
        {q.data_scope.type === 'SNAPSHOT' && (
          <input
            aria-label="Snapshot date"
            type="date"
            disabled={!canEdit}
            value={q.data_scope.date || ''}
            onChange={(e) => put({ data_scope: { ...q.data_scope, date: e.target.value } })}
          />
        )}{' '}
        {q.data_scope.type === 'DATE_RANGE' && (
          <>
            <input
              aria-label="Range start date"
              type="date"
              disabled={!canEdit}
              value={q.data_scope.from || ''}
              onChange={(e) => put({ data_scope: { ...q.data_scope, from: e.target.value } })}
            />
            <span>to</span>
            <input
              aria-label="Range end date"
              type="date"
              disabled={!canEdit}
              value={q.data_scope.to || ''}
              onChange={(e) => put({ data_scope: { ...q.data_scope, to: e.target.value } })}
            />
          </>
        )}
        <span className="scope-hint">
          {q.data_scope.type === 'LATEST' ? 'Latest available data' : 'Daily snapshot data'}
        </span>
      </div>
      {q.data_scope.type === 'DATE_RANGE' && (
        <div className="history-banner">
          <Info size={15} />
          <span>
            Historical mode: a device may appear once per day.{' '}
            {q.columns.includes('report_date') || summary
              ? 'Group by Snapshot Date to compare days.'
              : 'Include Snapshot Date to distinguish records.'}
          </span>
          {!q.columns.includes('report_date') && !summary && (
            <button onClick={() => put({ columns: [...q.columns, 'report_date'] })}>
              Add Snapshot Date
            </button>
          )}
        </div>
      )}
      <div className="builder-workspace">
        <aside className="field-browser">
          <div className="builder-panel-heading">
            <span>DATA</span>
            <Database size={14} />
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Search fields…" />
          <div className="field-groups">
            {[...new Set(fields.map((f) => f.category))].map((category) => {
              const matches = fields.filter(
                (f) =>
                  f.category === category && f.label.toLowerCase().includes(search.toLowerCase()),
              );
              return (
                matches.length > 0 && (
                  <div key={category}>
                    <h4>{category}</h4>
                    {matches.map((f) => (
                      <label className="field-option" key={f.id} title={f.description}>
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={(summary ? q.group_by : q.columns).includes(f.id)}
                          onChange={() => selectField(f.id)}
                        />
                        <span>{f.label}</span>
                        <small>{f.type === 'number' ? '#' : f.type === 'date' ? '◷' : 'Aa'}</small>
                      </label>
                    ))}
                  </div>
                )
              );
            })}
          </div>
          {dataset.relationships?.length && (
            <div className="related-section">
              <h4>
                <Link2 size={13} />
                Related data
              </h4>
              {dataset.relationships.map((r) => (
                <label className="field-option" key={r.id}>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={q.related.includes(r.id)}
                    onChange={(e) => {
                      const related = e.target.checked
                        ? [...q.related, r.id]
                        : q.related.filter((id) => id !== r.id);
                      const remove = (id: string) => !id.startsWith(r.id + '.') || e.target.checked;
                      put({
                        related,
                        columns: q.columns.filter(remove),
                        group_by: q.group_by.filter(remove),
                        filters: q.filters.filter((f) => remove(f.field)),
                        sort: [],
                        metrics: q.metrics.filter((m) => remove(m.field)),
                      });
                    }}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          )}
          <div className="field-bottom">
            <Info size={14} />
            <span>Choose fields to shape your report.</span>
          </div>
        </aside>
        <section className="configuration">
          <div className="builder-panel-heading">
            <span>CONFIGURATION</span>
            <Settings2 size={14} />
          </div>
          <fieldset disabled={!canEdit} className="config-fieldset">
            <div className="config-section">
              <h3>Report type</h3>
              <div className="segmented wide-segment">
                <button
                  className={!summary ? 'active' : ''}
                  onClick={() => put({ metrics: [], group_by: [], sort: [] })}
                >
                  <Table2 size={14} />
                  Detail
                </button>
                <button
                  className={summary ? 'active' : ''}
                  onClick={() => {
                    if (!summary) put({ metrics: [defaultMetric()], group_by: [], sort: [] });
                  }}
                >
                  <BarChart3 size={14} />
                  Summary
                </button>
              </div>
            </div>
            {!summary ? (
              <div className="config-section">
                <h3>
                  <Columns3 size={14} />
                  Columns<span>{q.columns.length}</span>
                </h3>
                <div className="selected-columns">
                  {q.columns.map((id, i) => (
                    <div
                      className="column-item"
                      key={id}
                      draggable={canEdit}
                      onDragStart={() => setDrag(id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag) move(q.columns.indexOf(drag), i);
                        setDrag(null);
                      }}
                    >
                      <div>
                        <GripVertical size={13} />
                        <button onClick={() => setEditingColumn(editingColumn === id ? null : id)}>
                          {q.labels[id] || field(id)?.label}
                        </button>
                        <button
                          className="icon-btn tiny"
                          aria-label={'Move ' + field(id)?.label + ' up'}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          className="icon-btn tiny"
                          aria-label={'Move ' + field(id)?.label + ' down'}
                          disabled={i === q.columns.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          className="icon-btn tiny"
                          aria-label={'Remove ' + field(id)?.label}
                          onClick={() => selectField(id)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {editingColumn === id && (
                        <label className="column-label">
                          Display name
                          <input
                            value={q.labels[id] || field(id)?.label || ''}
                            onChange={(e) => put({ labels: { ...q.labels, [id]: e.target.value } })}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                <p className="config-hint">Select fields on the left to add columns.</p>
              </div>
            ) : (
              <>
                <div className="config-section">
                  <h3>
                    Group by<span>{q.group_by.length}</span>
                  </h3>
                  {q.group_by.map((id, i) => (
                    <div className="select-row" key={id}>
                      <select
                        aria-label={'Grouping dimension ' + (i + 1)}
                        value={id}
                        onChange={(e) =>
                          put({
                            group_by: q.group_by.map((x, j) => (i === j ? e.target.value : x)),
                            sort: [],
                          })
                        }
                      >
                        {fields
                          .filter((f) => f.id === id || !q.group_by.includes(f.id))
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                      </select>
                      <button
                        className="icon-btn"
                        aria-label="Remove grouping"
                        onClick={() =>
                          put({ group_by: q.group_by.filter((x) => x !== id), sort: [] })
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="add-rule"
                    disabled={q.group_by.length >= 5}
                    onClick={() => {
                      const f = fields.find((f) => !q.group_by.includes(f.id));
                      if (f) put({ group_by: [...q.group_by, f.id], sort: [] });
                    }}
                  >
                    <Plus size={14} />
                    Add dimension
                  </button>
                  {!q.group_by.length && (
                    <p className="config-hint">No grouping returns a single total.</p>
                  )}
                </div>
                <div className="config-section">
                  <h3>
                    Metrics<span>{q.metrics.length}</span>
                  </h3>
                  {q.metrics.map((m, i) => (
                    <div className="metric-item" key={m.alias}>
                      <div className="select-row">
                        <input
                          aria-label="Metric label"
                          value={m.label}
                          onChange={(e) =>
                            put({
                              metrics: q.metrics.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <button
                          className="icon-btn"
                          aria-label="Remove metric"
                          onClick={() =>
                            put({ metrics: q.metrics.filter((_, j) => i !== j), sort: [] })
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <select
                        aria-label="Metric field"
                        value={m.field}
                        onChange={(e) =>
                          put({
                            metrics: q.metrics.map((x, j) =>
                              i === j
                                ? { ...x, field: e.target.value, aggregation: 'count_distinct' }
                                : x,
                            ),
                          })
                        }
                      >
                        {fields.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Aggregation"
                        value={m.aggregation}
                        onChange={(e) =>
                          put({
                            metrics: q.metrics.map((x, j) =>
                              j === i ? { ...x, aggregation: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        {(
                          metadata.aggregations?.[field(m.field)?.type || 'string'] || [
                            'count',
                            'count_distinct',
                          ]
                        ).map((a: string) => (
                          <option key={a} value={a}>
                            {a.replaceAll('_', ' ').replace(/^./, (s) => s.toUpperCase())}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <button
                    className="add-rule"
                    disabled={q.metrics.length >= 10}
                    onClick={() => put({ metrics: [...q.metrics, defaultMetric()] })}
                  >
                    <Plus size={14} />
                    Add metric
                  </button>
                </div>
              </>
            )}
            <div className="config-section">
              <h3>
                <Filter size={14} />
                Filters{q.filters.length > 0 && <span>Match all</span>}
              </h3>
              {q.filters.map((f, i) => (
                <div className="filter-item" key={i}>
                  <div className="select-row">
                    <select
                      aria-label={'Filter field ' + (i + 1)}
                      value={f.field}
                      onChange={(e) =>
                        put({
                          filters: q.filters.map((x, j) =>
                            i === j ? { field: e.target.value, operator: 'equals', value: '' } : x,
                          ),
                        })
                      }
                    >
                      {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      aria-label="Remove filter"
                      onClick={() => put({ filters: q.filters.filter((_, j) => i !== j) })}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <select
                    aria-label={'Filter condition ' + (i + 1)}
                    value={f.operator}
                    onChange={(e) =>
                      put({
                        filters: q.filters.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                operator: e.target.value,
                                value: ['in', 'not_in', 'between'].includes(e.target.value)
                                  ? ['', '']
                                  : '',
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    {(metadata.operators?.[field(f.field)?.type || 'string'] || ['equals']).map(
                      (op: string) => (
                        <option key={op} value={op}>
                          {op.replaceAll('_', ' ')}
                        </option>
                      ),
                    )}
                  </select>
                  {!['is_empty', 'is_not_empty'].includes(f.operator) &&
                    (f.field === 'status' && ['equals', 'not_equals'].includes(f.operator) ? (
                      <select
                        aria-label="Filter value"
                        title={field(f.field)?.description}
                        value={f.value}
                        onChange={(e) =>
                          put({
                            filters: q.filters.map((x, j) =>
                              i === j ? { ...x, value: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        <option value="">Choose status</option>
                        {['Online', 'Offline', 'Idle', 'Unknown'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : f.operator === 'between' ? (
                      <div className="range-inputs">
                        {[0, 1].map((n) => (
                          <input
                            key={n}
                            aria-label={n ? 'Upper bound' : 'Lower bound'}
                            type={
                              field(f.field)?.type === 'date'
                                ? 'date'
                                : field(f.field)?.type === 'number'
                                  ? 'number'
                                  : 'text'
                            }
                            value={f.value?.[n] ?? ''}
                            onChange={(e) => {
                              const values = [...(Array.isArray(f.value) ? f.value : ['', ''])];
                              values[n] = e.target.value;
                              put({
                                filters: q.filters.map((x, j) =>
                                  i === j ? { ...x, value: values } : x,
                                ),
                              });
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <input
                        aria-label={'Filter value ' + (i + 1)}
                        placeholder={
                          ['in', 'not_in'].includes(f.operator)
                            ? 'Values, separated by commas'
                            : 'Enter a value'
                        }
                        type={
                          ['in', 'not_in'].includes(f.operator)
                            ? 'text'
                            : field(f.field)?.type === 'number'
                              ? 'number'
                              : field(f.field)?.type === 'date'
                                ? 'date'
                                : 'text'
                        }
                        value={Array.isArray(f.value) ? f.value.join(',') : (f.value ?? '')}
                        onChange={(e) =>
                          put({
                            filters: q.filters.map((x, j) =>
                              i === j
                                ? {
                                    ...x,
                                    value: ['in', 'not_in'].includes(f.operator)
                                      ? e.target.value.split(',').map((s) => s.trim())
                                      : e.target.value,
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    ))}
                </div>
              ))}
              <button
                className="add-rule"
                onClick={() =>
                  put({
                    filters: [
                      ...q.filters,
                      {
                        field: fields.find((f) => f.id === 'status')?.id || fields[0].id,
                        operator: 'equals',
                        value: fields.some((f) => f.id === 'status') ? 'Online' : '',
                      },
                    ],
                  })
                }
              >
                <Plus size={14} />
                Add filter
              </button>
            </div>
            <div className="config-section">
              <h3>
                <ListFilter size={14} />
                Sorting
              </h3>
              {q.sort.map((s, i) => (
                <div className="sort-item" key={i}>
                  <select
                    aria-label={'Sort field ' + (i + 1)}
                    value={s.field}
                    onChange={(e) =>
                      put({
                        sort: q.sort.map((x, j) => (i === j ? { ...x, field: e.target.value } : x)),
                      })
                    }
                  >
                    {outputs.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Sort direction"
                    value={s.direction}
                    onChange={(e) =>
                      put({
                        sort: q.sort.map((x, j) =>
                          i === j ? { ...x, direction: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                  <button
                    className="icon-btn"
                    aria-label="Remove sorting"
                    onClick={() => put({ sort: q.sort.filter((_, j) => i !== j) })}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                className="add-rule"
                disabled={!outputs.length}
                onClick={() =>
                  put({ sort: [...q.sort, { field: outputs[0]?.id, direction: 'asc' }] })
                }
              >
                <Plus size={14} />
                Add sort
              </button>
            </div>
            <div className="config-section">
              <label className="limit-label">
                Row limit
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={q.limit}
                  onChange={(e) => put({ limit: Number(e.target.value) })}
                />
              </label>
              <p className="config-hint">Automatic previews return up to 100 rows.</p>
            </div>
          </fieldset>
        </section>
        <section className="results-panel">
          <div className="results-header">
            <div className="tabs">
              <button className={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')}>
                <Table2 size={15} />
                Table
              </button>
              <button
                className={tab === 'visualization' ? 'active' : ''}
                onClick={() => setTab('visualization')}
              >
                <BarChart3 size={16} />
                Visualization
              </button>
            </div>
            <button
              className="btn small"
              disabled={!result || loading || !!error}
              onClick={() => result && exportCSV(result, report.name)}
            >
              <Download size={14} />
              CSV
            </button>
          </div>
          <div className="query-status">
            <span className={'execution-dot ' + (loading ? 'running' : error ? 'failed' : '')} />
            {loading
              ? 'Running report…'
              : error
                ? 'Unable to load report'
                : !result && dirty
                  ? 'Configuration changed · Run report to update results'
                  : `${fmt(result?.metadata.row_count || 0)} rows · ${preview ? 'Preview' : 'Full results'}`}
            <span>
              {result && !loading && !error
                ? 'Updated ' +
                  new Date(result.metadata.executed_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </span>
          </div>
          {tab === 'visualization' && (
            <div className="visualization-config">
              <div className="chart-type-grid">
                {chartTypes.map(([type, label, Icon]) => (
                  <button
                    key={type}
                    disabled={!!compatibility(type)}
                    title={compatibility(type) || label}
                    className={config.type === type ? 'active' : ''}
                    onClick={() =>
                      setViz({
                        type,
                        dimension: q.group_by[0],
                        measures: q.metrics.map((m) => m.alias),
                      })
                    }
                  >
                    <Icon size={20} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {!summary && (
                <div className="info-box">
                  Switch to Summary and add a numeric metric to create a chart.
                </div>
              )}
              {summary && config.type !== 'table' && (
                <div className="chart-mappings">
                  {config.type !== 'kpi' && (
                    <label>
                      Category
                      <select
                        value={effectiveConfig.dimension || ''}
                        onChange={(e) => setViz({ dimension: e.target.value })}
                      >
                        {q.group_by.map((id) => (
                          <option key={id} value={id}>
                            {field(id)?.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Value
                    <select
                      value={effectiveConfig.measures[0] || ''}
                      onChange={(e) => setViz({ measures: [e.target.value] })}
                    >
                      {q.metrics.map((m) => (
                        <option key={m.alias} value={m.alias}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="display-options">
                    {(['legend', 'values', 'grid'] as const).map((key) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={config.options[key] || false}
                          onChange={(e) =>
                            setViz({ options: { ...config.options, [key]: e.target.checked } })
                          }
                        />
                        {key === 'grid' ? 'Grid lines' : key === 'values' ? 'Values' : 'Legend'}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="result-body" ref={chartRef}>
            {loading ? (
              <Loading />
            ) : error ? (
              <ErrorState error={error} retry={() => setManualRun((n) => n + 1)} />
            ) : result ? (
              tab === 'table' ? (
                <DataTable result={result} />
              ) : compatibility(config.type) ? (
                <Empty
                  title="Give your data the right shape"
                  description={compatibility(config.type)}
                />
              ) : (
                <Chart result={result} config={effectiveConfig} height={330} />
              )
            ) : (
              <Empty title={dirty ? 'Run report to apply your changes' : undefined} />
            )}
          </div>
          {tab === 'visualization' && result && !error && !loading && (
            <div className="chart-actions">
              <button
                className="btn small"
                disabled={['table', 'kpi'].includes(config.type) || !!compatibility(config.type)}
                onClick={exportPNG}
              >
                <Download size={14} />
                Export PNG
              </button>
              {canEdit && (
                <button
                  className="btn small"
                  disabled={!!compatibility(config.type)}
                  onClick={() => {
                    setSaveViz(true);
                    setSaveModal(true);
                  }}
                >
                  <Save size={14} />
                  Save visualization
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      {saveModal && (
        <Modal
          title={report.id ? 'Save report' : 'Save your report'}
          onClose={() => setSaveModal(false)}
        >
          <form onSubmit={save}>
            <label>
              Name
              <input
                name="name"
                defaultValue={report.name === 'Untitled report' ? '' : report.name}
                placeholder="e.g. Devices by OS version"
                maxLength={120}
                required
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={report.description}
                placeholder="What does this report show?"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={saveViz}
                onChange={(e) => setSaveViz(e.target.checked)}
              />
              Save visualization too
            </label>
            {saveViz && (
              <>
                <label>
                  Visualization name
                  <input
                    name="viz_name"
                    defaultValue={visualization?.name || report.name}
                    required
                  />
                </label>
                {compatibility(config.type) && (
                  <p className="error-text">{compatibility(config.type)}</p>
                )}
              </>
            )}
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setSaveModal(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={saving || (saveViz && !!compatibility(config.type))}
                type="submit"
              >
                {saving ? 'Saving…' : 'Save report'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {advanced && (
        <Modal title="Generated query" wide onClose={() => setAdvanced(false)}>
          <p className="modal-description">
            Read-only SQL generated from the report definition. Credentials remain on the server.
          </p>
          <QueryInspector q={q} />
        </Modal>
      )}
      {discard && (
        <Modal title="Discard unsaved changes?" onClose={() => setDiscard(false)}>
          <p className="modal-description">
            Your saved report will keep its previous configuration.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button className="btn danger" onClick={onClose}>
              Discard changes
            </button>
          </div>
        </Modal>
      )}
      {addDashboard && (
        <Modal title="Add to dashboard" onClose={() => setAddDashboard(false)}>
          <p className="modal-description">
            Choose a dashboard for this {visualization ? 'visualization' : 'report'}.
          </p>
          <div className="picker-list">
            {dashboards.map((d) => (
              <button
                key={d.id}
                onClick={async () => {
                  try {
                    await api('/dashboards/' + d.id, 'PUT', {
                      ...d,
                      widgets: [
                        ...d.widgets,
                        {
                          id: crypto.randomUUID(),
                          type: visualization ? 'visualization' : 'report',
                          resource_id: visualization?.id || report.id,
                          layout: { width: visualization ? 6 : 12, height: 4 },
                        },
                      ],
                    });
                    setAddDashboard(false);
                    await onSaved(report, visualization);
                    notify('Added to ' + d.name);
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <span>
                  <strong>{d.name}</strong>
                  <small>{d.widgets.length} widgets</small>
                </span>
                <Plus size={16} />
              </button>
            ))}
            {!dashboards.length && (
              <Empty
                title="Create a dashboard first"
                description="Use New dashboard on the Dashboards page."
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function QueryInspector({ q }: { q: Query }) {
  const [sql, setSQL] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api('/reporting/query/compile', 'POST', q)
      .then((r) => setSQL(r.query))
      .catch((e) => setError(e.message));
  }, [q]);
  return error ? (
    <ErrorState error={error} />
  ) : (
    <>
      <pre className="query-code">{sql || 'Compiling…'}</pre>
      <div className="info-box">
        Data scope:{' '}
        {q.data_scope.type === 'LATEST'
          ? 'Latest snapshot (latest_data: true)'
          : q.data_scope.type === 'SNAPSHOT'
            ? q.data_scope.date
            : q.data_scope.from + ' – ' + q.data_scope.to}
      </div>
    </>
  );
}
