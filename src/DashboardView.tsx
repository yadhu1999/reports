import { CachedKpi, useCacheView } from './cache-status';
import { useEffect, useState, useRef } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  GripVertical,
  LayoutGrid,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { api, run, fmt } from './api';
import type { Dashboard, Report, Viz, Widget, Result } from './types';
import {
  Chart,
  DataTable,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageHeading,
  SearchBox,
} from './components';
type Props = {
  dashboard: Dashboard;
  reports: Report[];
  visualizations: Viz[];
  canEdit: boolean;
  onSave: (d: Dashboard) => Promise<void>;
  openReport: (id: string) => void;
  onBack: () => void;
  notify: (s: string) => void;
};
export default function DashboardView({
  dashboard,
  reports,
  visualizations,
  canEdit,
  onSave,
  openReport,
  onBack,
  notify,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dashboard);
  const [refresh, setRefresh] = useState(0);
  const [add, setAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resize = useRef<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    unit: number;
  } | null>(null);
  useEffect(() => {
    setDraft(dashboard);
    setEditing(false);
  }, [dashboard]);
  const current = editing ? draft : dashboard;
  const updateWidgets = (widgets: Widget[]) => setDraft({ ...draft, widgets });
  const addWidget = (type: 'report' | 'visualization', id: string) => {
    const v = visualizations.find((v) => v.id === id);
    updateWidgets([
      ...draft.widgets,
      {
        id: crypto.randomUUID(),
        type,
        resource_id: id,
        layout: {
          width: type === 'report' ? 12 : v?.visualization_definition.type === 'kpi' ? 4 : 6,
          height: v?.visualization_definition.type === 'kpi' ? 2 : 4,
        },
      },
    ]);
    setAdd(false);
  };
  return (
    <>
      <button className="breadcrumb" onClick={onBack}>
        <LayoutGrid size={14} />
        Dashboards<span>/</span>
        <span>{dashboard.name}</span>
      </button>
      <PageHeading title={dashboard.name} description={dashboard.description}>
        <button
          className={'icon-btn favorite ' + (dashboard.favorite ? 'selected' : '')}
          aria-label="Toggle favorite"
          disabled={!canEdit}
          onClick={() => onSave({ ...dashboard, favorite: !dashboard.favorite })}
        >
          <Star size={19} />
        </button>
        {editing ? (
          <>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSave(draft);
                  setEditing(false);
                  notify('Dashboard saved');
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Check size={16} />
              Save changes
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setRefresh((n) => n + 1)}>
              <RefreshCw size={15} />
              Refresh
            </button>
            {canEdit && (
              <button
                className="btn primary"
                onClick={() => {
                  setDraft(structuredClone(dashboard));
                  setEditing(true);
                }}
              >
                <Pencil size={15} />
                Edit dashboard
              </button>
            )}
          </>
        )}
      </PageHeading>
      <div className="dashboard-context">
        <div className="scope-chip">
          <Database size={14} />
          <strong>Snapshot</strong>
          <span>Latest available</span>
        </div>
        <span className="context-note">
          <Clock3 size={14} />
          Widgets refresh independently
        </span>
        {editing && (
          <button className="btn small" onClick={() => setAdd(true)}>
            <Plus size={15} />
            Add widget
          </button>
        )}
      </div>
      {editing && (
        <div className="edit-notice">
          <GripVertical size={16} />
          Drag widgets to rearrange. Use the size control to adjust their width.
        </div>
      )}
      {!current.widgets.length ? (
        <div className="panel">
          <Empty
            title="Make room for your insights"
            description="Add a saved report or visualization to your dashboard."
            action={
              <button
                className="btn primary"
                disabled={!canEdit}
                onClick={() => {
                  setEditing(true);
                  setAdd(true);
                }}
              >
                <Plus size={16} />
                Add your first widget
              </button>
            }
          />
        </div>
      ) : (
        <div className={'dashboard-grid ' + (editing ? 'is-editing' : '')}>
          {current.widgets.map((w, i) => (
            <div
              key={w.id}
              className={'widget-wrap ' + (drag === w.id ? 'dragging' : '')}
              style={{ gridColumn: `span ${w.layout.width}` }}
              draggable={editing}
              onDragStart={(e) => {
                setDrag(w.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag || drag === w.id) return;
                const list = [...draft.widgets];
                const from = list.findIndex((x) => x.id === drag);
                const [moved] = list.splice(from, 1);
                list.splice(i, 0, moved);
                updateWidgets(list);
                setDrag(null);
              }}
            >
              {editing && (
                <div className="widget-edit">
                  <GripVertical size={16} />
                  <span>Widget {i + 1}</span>
                  <button
                    className="icon-btn"
                    aria-label="Move widget earlier"
                    disabled={i === 0}
                    onClick={() => {
                      const list = [...draft.widgets];
                      [list[i - 1], list[i]] = [list[i], list[i - 1]];
                      updateWidgets(list);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Move widget later"
                    disabled={i === draft.widgets.length - 1}
                    onClick={() => {
                      const list = [...draft.widgets];
                      [list[i + 1], list[i]] = [list[i], list[i + 1]];
                      updateWidgets(list);
                    }}
                  >
                    ↓
                  </button>
                  <select
                    aria-label="Widget width"
                    value={w.layout.width}
                    onChange={(e) =>
                      updateWidgets(
                        draft.widgets.map((x) =>
                          x.id === w.id
                            ? { ...x, layout: { ...x.layout, width: Number(e.target.value) } }
                            : x,
                        ),
                      )
                    }
                  >
                    {[3, 4, 5, 6, 7, 8, 9, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}/12 width
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-btn"
                    aria-label="Duplicate widget"
                    onClick={() =>
                      updateWidgets([
                        ...draft.widgets,
                        { ...structuredClone(w), id: crypto.randomUUID() },
                      ])
                    }
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Remove widget"
                    onClick={() => updateWidgets(draft.widgets.filter((x) => x.id !== w.id))}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <DashboardWidget
                widget={w}
                reports={reports}
                visualizations={visualizations}
                refresh={refresh}
                openReport={openReport}
              />
              {editing && (
                <button
                  className="resize-handle"
                  aria-label="Resize widget; use arrow keys to adjust width and height"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    resize.current = {
                      id: w.id,
                      x: e.clientX,
                      y: e.clientY,
                      width: w.layout.width,
                      height: w.layout.height,
                      unit:
                        e.currentTarget.closest('.dashboard-grid')!.getBoundingClientRect().width /
                        12,
                    };
                  }}
                  onPointerMove={(e) => {
                    const r = resize.current;
                    if (!r || r.id !== w.id) return;
                    const width = Math.min(
                      12,
                      Math.max(3, r.width + Math.round((e.clientX - r.x) / r.unit)),
                    );
                    const height = Math.min(
                      8,
                      Math.max(2, r.height + Math.round((e.clientY - r.y) / 60)),
                    );
                    setDraft((d) => ({
                      ...d,
                      widgets: d.widgets.map((x) =>
                        x.id === w.id ? { ...x, layout: { width, height } } : x,
                      ),
                    }));
                  }}
                  onPointerUp={() => {
                    resize.current = null;
                  }}
                  onPointerCancel={() => {
                    resize.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
                      return;
                    e.preventDefault();
                    updateWidgets(
                      draft.widgets.map((x) =>
                        x.id === w.id
                          ? {
                              ...x,
                              layout: {
                                width: Math.min(
                                  12,
                                  Math.max(
                                    3,
                                    x.layout.width +
                                      (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0),
                                  ),
                                ),
                                height: Math.min(
                                  8,
                                  Math.max(
                                    2,
                                    x.layout.height +
                                      (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0),
                                  ),
                                ),
                              },
                            }
                          : x,
                      ),
                    );
                  }}
                >
                  <Maximize2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="dashboard-foot">
        <Database size={13} />
        <span>Powered by DataTap</span>
        <span>Snapshot counts. Online + Offline excludes Idle and Unknown.</span>
      </div>
      {add && (
        <Modal title="Add to dashboard" onClose={() => setAdd(false)}>
          <p className="modal-description">Bring your saved insights together.</p>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search reports and visualizations…"
          />
          <div className="picker-list">
            <h4>Saved visualizations</h4>
            {visualizations
              .filter((v) => v.name.toLowerCase().includes(search.toLowerCase()))
              .map((v) => (
                <button key={v.id} onClick={() => addWidget('visualization', v.id)}>
                  <span className="item-icon">
                    <Activity size={19} />
                  </span>
                  <span>
                    <strong>{v.name}</strong>
                    <small>{v.visualization_definition.type.replaceAll('_', ' ')} chart</small>
                  </span>
                  <Plus size={17} />
                </button>
              ))}
            <h4>Saved reports</h4>
            {reports
              .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
              .map((r) => (
                <button key={r.id} onClick={() => addWidget('report', r.id)}>
                  <span className="item-icon">
                    <Database size={18} />
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.query_definition.source}</small>
                  </span>
                  <Plus size={17} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
function DashboardWidget({
  widget,
  reports,
  visualizations,
  refresh,
  openReport,
}: {
  widget: Widget;
  reports: Report[];
  visualizations: Viz[];
  refresh: number;
  openReport: (id: string) => void;
}) {
  const viz =
    widget.type === 'visualization'
      ? visualizations.find((v) => v.id === widget.resource_id)
      : undefined;
  const report = reports.find((r) => r.id === (viz?.report_id || widget.resource_id));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [local, setLocal] = useState(0);
  const wake = useCacheView(setResult);
  const refreshSeen = useRef(`${refresh}:${local}`);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setResult(null);
    if (!report) {
      setError('This report is no longer available.');
      return;
    }
    const force = refreshSeen.current !== `${refresh}:${local}`;
    refreshSeen.current = `${refresh}:${local}`;
    run(report.query_definition, false, controller.signal, force, (r) => {
      if (!controller.signal.aborted) setResult(r);
    })
      .then((r) => {
        if (!controller.signal.aborted) setResult(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [report?.id, report?.updated_at, refresh, local, wake]);
  const kpi = viz?.visualization_definition.type === 'kpi';
  const title = viz?.name || report?.name || 'Report unavailable';
  const offline = title.toLowerCase().includes('offline');
  const online = !offline && title.toLowerCase().includes('online');
  const Icon = offline ? WifiOff : online ? Wifi : Database;
  return (
    <section
      className={'panel widget ' + (kpi ? 'kpi-widget' : '')}
      style={kpi ? { minHeight: widget.layout.height * 70 + 28 } : undefined}
    >
      <div className="widget-title">
        <h3>{title}</h3>
        <div>
          {!kpi && (
            <button
              className="icon-btn"
              aria-label={'Refresh ' + title}
              onClick={() => setLocal((n) => n + 1)}
            >
              <RefreshCw size={14} />
            </button>
          )}
          <button
            className="icon-btn"
            aria-label={'Open ' + title}
            disabled={!report}
            onClick={() => report && openReport(report.id)}
          >
            {kpi ? <Icon size={18} /> : <ArrowUpRight size={17} />}
          </button>
        </div>
      </div>
      {error ? (
        <ErrorState error={error} retry={() => setLocal((n) => n + 1)} />
      ) : !result ? (
        <Loading />
      ) : kpi ? (
        <>
          <CachedKpi result={result} />
          <div className="kpi-caption">
            <span className={offline ? 'amber-text' : 'green-text'}>
              {offline
                ? 'Last seen >24h at snapshot'
                : online
                  ? 'Last seen ≤30m at snapshot'
                  : 'Latest snapshot'}
            </span>
            <span>
              ·{' '}
              {new Date(result.metadata.executed_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="widget-subtitle">{report?.description}</div>
          {viz ? (
            <div className="widget-chart">
              <Chart
                result={result}
                config={viz.visualization_definition}
                height={widget.layout.height * 60}
              />
            </div>
          ) : (
            <DataTable
              result={result}
              compact
              pageSize={Math.max(3, widget.layout.height * 2 - 3)}
            />
          )}
          {viz && (
            <div className="widget-footer">
              <span>{result.metadata.row_count} categories</span>
              <span>
                {report?.query_definition.data_scope.type === 'LATEST'
                  ? 'Latest snapshot'
                  : 'Historical snapshots'}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
