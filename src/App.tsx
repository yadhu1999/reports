import { clearLocalCache } from './result-cache';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  Database,
  FileText,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api, shortDate } from './api';
import type { Dashboard, Dataset, Report, User, Viz } from './types';
import { Empty, ErrorState, Loading, Modal, PageHeading, SearchBox } from './components';
import DashboardView from './DashboardView';
import ReportBuilder from './ReportBuilder';
import Explorer from './Explorer';
import ConnectionSettings from './ConnectionSettings';
type Page = 'overview' | 'dashboards' | 'reports' | 'visualizations' | 'explorer' | 'settings';
export default function App() {
  const [session, setSession] = useState<{
    user: User;
    mode: string;
    localWorkspace: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [visualizations, setVisualizations] = useState<Viz[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [catalog, setCatalog] = useState<Dataset[]>([]);
  const [metadata, setMetadata] = useState<any>({});
  const [page, setPage] = useState<Page>('dashboards');
  const [activeDash, setActiveDash] = useState<string | null>('dash_fleet');
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [activeViz, setActiveViz] = useState<Viz | undefined>();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'report' | 'dashboard' | 'help' | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ kind: string; id: string; name: string } | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [mobile, setMobile] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [datasetFilter, setDatasetFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const notify = (s: string) => setNotice(s);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function reload() {
    const [r, v, d, m] = await Promise.all([
      api<Report[]>('/reports'),
      api<Viz[]>('/visualizations'),
      api<Dashboard[]>('/dashboards'),
      api('/reporting/datasets'),
    ]);
    setReports(r);
    setVisualizations(v);
    setDashboards(d);
    setCatalog(m.datasets);
    setMetadata(m);
  }
  useEffect(() => {
    api('/session')
      .then((s) => {
        setSession(s);
        return reload();
      })
      .catch((e) => {
        if (e.message !== 'Sign in to continue.') setLoadError(e.message);
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const context = (
      document as Document & { modelContext?: { registerTool: (tool: any, options: any) => void } }
    ).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    try {
      context.registerTool(
        {
          name: 'open_saved_report',
          description:
            'Open an existing saved report in the visual report builder. Does not change its saved definition.',
          inputSchema: {
            type: 'object',
            properties: { report_id: { type: 'string' } },
            required: ['report_id'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: async (input: { report_id: string }) => {
            const r = reports.find((r) => r.id === input.report_id);
            if (!r) throw Error('Report not found.');
            setActiveReport(structuredClone(r));
            setActiveViz(undefined);
            setPage('reports');
            return { opened: true, name: r.name };
          },
        },
        { signal: controller.signal },
      );
    } catch {}
    return () => controller.abort();
  }, [reports]);
  const go = (p: Page) => {
    setPage(p);
    setActiveReport(null);
    setActiveViz(undefined);
    setActiveDash(null);
    setSearch('');
    setMobile(false);
    setFavoriteOnly(false);
  };
  const openReport = (id: string, v?: Viz) => {
    const r = reports.find((r) => r.id === id);
    if (r) {
      setActiveReport(structuredClone(r));
      setActiveViz(v);
      setPage('reports');
    }
  };
  const canEdit = session?.user.role !== 'viewer';
  const saveDashboard = async (d: Dashboard) => {
    try {
      const saved = await api<Dashboard>('/dashboards/' + d.id, 'PUT', d);
      setDashboards((ds) => ds.map((x) => (x.id === d.id ? saved : x)));
    } catch (e) {
      notify((e as Error).message);
      throw e;
    }
  };
  const duplicate = async (kind: string, id: string) => {
    try {
      await api(`/${kind}/${id}/duplicate`, 'POST');
      await reload();
      notify('Copy created');
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const newReport = (source: string) => {
    const fields = catalog.find((d) => d.id === source)!.fields;
    setActiveReport({
      id: '',
      name: 'Untitled report',
      description: '',
      updated_at: new Date().toISOString(),
      created_by: session!.user.name,
      query_definition: {
        source,
        data_scope: { type: 'LATEST' },
        columns: fields.slice(0, 4).map((f) => f.id),
        filters: [],
        metrics: [],
        group_by: [],
        sort: [],
        related: [],
        labels: {},
        limit: 1000,
      },
    });
    setActiveViz(undefined);
    setPage('reports');
    setModal(null);
  };
  if (!ready)
    return (
      <div className="boot">
        <img
          className="esper-logo esper-logo-dark"
          src="/esper-logo.svg"
          alt="Esper"
          width="126"
          height="41"
        />
        <Loading />
      </div>
    );
  if (!session)
    return (
      <div className="login-page">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api('/login', 'POST', { email: f.get('email'), password: f.get('password') });
              setSession(await api('/session'));
              await reload();
            } catch (e) {
              setLoginError((e as Error).message);
            }
          }}
        >
          <div className="login-brand">
            <img
              className="esper-logo esper-logo-dark"
              src="/esper-logo.svg"
              alt="Esper"
              width="126"
              height="41"
            />
          </div>
          <h1>Your fleet. In focus.</h1>
          <p>Sign in to your Reporting workspace.</p>
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          {loginError && <p className="error-text">{loginError}</p>}
          <button className="btn primary" type="submit">
            Sign in
            <ArrowRight size={16} />
          </button>
          {loadError && <p>{loadError}</p>}
        </form>
      </div>
    );
  const currentDash = dashboards.find((d) => d.id === activeDash);
  const navItems: [Page, string, any][] = [
    ['overview', 'Overview', LayoutGrid],
    ['dashboards', 'Dashboards', LayoutDashboard],
    ['reports', 'Reports', FileText],
    ['visualizations', 'Visualizations', ChartNoAxesCombined],
    ['explorer', 'Data explorer', Database],
  ];
  const filteredReports = reports.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) &&
      (!datasetFilter || r.query_definition.source === datasetFilter) &&
      (!ownerFilter || r.created_by === ownerFilter) &&
      (!typeFilter || (r.query_definition.metrics.length ? 'summary' : 'detail') === typeFilter),
  );
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobile ? 'mobile-open' : '')}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go('overview');
          }}
        >
          <img className="esper-logo" src="/esper-logo.svg" alt="Esper" width="126" height="41" />
          <span className="brand-product">CONSOLE</span>
        </a>
        <button className="workspace-switch" onClick={() => setModal('help')}>
          <span className="workspace-avatar">A</span>
          <span>
            <strong>
              {session.mode === 'demo' ? 'Acme workspace' : session.user.tenant || 'Workspace'}
            </strong>
            <small>{session.mode === 'demo' ? 'Sample environment' : session.user.role}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? 'nav-item active' : 'nav-item'}
              onClick={() => go(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === 'reports' && <small>{reports.length}</small>}
            </button>
          ))}
        </nav>
        <div className="nav-label favorite-label">
          FAVORITES
          <Star size={12} />
        </div>
        <div className="sidebar-favorites">
          {dashboards
            .filter((d) => d.favorite)
            .map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  go('dashboards');
                  setActiveDash(d.id);
                }}
              >
                <span className="favorite-dot" />
                {d.name}
              </button>
            ))}
        </div>
        <div className="sidebar-bottom">
          {session.user.role === 'administrator' && (
            <button
              className={'nav-item ' + (page === 'settings' ? 'active' : '')}
              onClick={() => go('settings')}
            >
              <Settings2 size={18} />
              Connection settings
            </button>
          )}
          <div className="data-connection">
            <div>
              <span className="connection-icon">
                <Database size={17} />
              </span>
              <strong>Esper DataTap</strong>
              <span className="connection-dot" />
            </div>
            <p>{session.mode === 'demo' ? 'Exploring sample data' : 'Server-managed connection'}</p>
          </div>
          <button className="nav-item" onClick={() => setModal('help')}>
            <HelpCircle size={18} />
            Help & resources
            <ArrowUpRight size={14} />
          </button>
          <button
            className="nav-item"
            onClick={async () => {
              await clearLocalCache();
              notify('Local result cache cleared. Saved reports are unchanged.');
            }}
          >
            Clear cached results
          </button>
          <div className="user-profile">
            <span className="user-avatar">
              {session.user.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span>
              <strong>{session.user.name}</strong>
              <small>{session.user.role}</small>
            </span>
            {!session.localWorkspace && (
              <button
                aria-label="Sign out"
                className="icon-btn"
                onClick={async () => {
                  await api('/logout', 'POST');
                  setSession(null);
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-toggle icon-btn"
              aria-label="Toggle navigation"
              onClick={() => setMobile(!mobile)}
            >
              <LayoutGrid size={20} />
            </button>
            <span className="topbar-title">Reporting</span>
            <span className="beta-badge">DATATAP</span>
          </div>
          <div className="topbar-right">
            <span className="demo-badge">
              {session.mode === 'live'
                ? 'Live data'
                : session.mode === 'demo'
                  ? 'Demo workspace'
                  : 'Not connected'}
            </span>
            <button
              className="icon-btn"
              aria-label="Help and resources"
              onClick={() => setModal('help')}
            >
              <BookOpen size={18} />
            </button>
            <span className="topbar-divider" />
            <span className="small-avatar">
              {session.user.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
          </div>
        </header>
        <main className={activeReport ? 'content builder-content' : 'content'}>
          {loadError ? (
            <ErrorState
              error={loadError}
              retry={() => {
                setLoadError('');
                reload().catch((e) => setLoadError(e.message));
              }}
            />
          ) : activeReport ? (
            <ReportBuilder
              key={activeReport.id + activeReport.query_definition.source + (activeViz?.id || '')}
              report={activeReport}
              visualization={activeViz}
              datasets={catalog}
              metadata={metadata}
              canEdit={canEdit}
              onClose={() => {
                setActiveReport(null);
                setActiveViz(undefined);
              }}
              onSaved={async (r: Report, v?: Viz) => {
                await reload();
                setActiveReport(r);
                setActiveViz(v);
                notify('Saved successfully');
              }}
              dashboards={dashboards}
              notify={notify}
            />
          ) : currentDash ? (
            <DashboardView
              dashboard={currentDash}
              reports={reports}
              visualizations={visualizations}
              canEdit={canEdit}
              onSave={saveDashboard}
              openReport={openReport}
              onBack={() => setActiveDash(null)}
              notify={notify}
            />
          ) : page === 'settings' ? (
            <ConnectionSettings />
          ) : page === 'explorer' ? (
            <Explorer datasets={catalog} onBuild={newReport} />
          ) : (
            <>
              <PageHeading
                eyebrow="YOUR ANALYTICS WORKSPACE"
                title={
                  page === 'overview'
                    ? 'A little clarity. A lot of possibility.'
                    : page === 'dashboards'
                      ? 'Dashboards'
                      : page === 'reports'
                        ? 'Reports'
                        : 'Visualizations'
                }
                description={
                  page === 'overview'
                    ? 'Turn your Esper data into a clearer picture.'
                    : page === 'dashboards'
                      ? 'Your fleet’s story, all in one place.'
                      : page === 'reports'
                        ? 'Explore, organize, and share insights from your fleet.'
                        : 'Different perspectives. Better decisions.'
                }
              >
                {canEdit && (
                  <>
                    {page === 'overview' && (
                      <button className="btn" onClick={() => setModal('dashboard')}>
                        <Plus size={16} />
                        New dashboard
                      </button>
                    )}
                    <button
                      className="btn primary"
                      onClick={() => setModal(page === 'dashboards' ? 'dashboard' : 'report')}
                    >
                      <Plus size={17} />
                      {page === 'dashboards'
                        ? 'New dashboard'
                        : page === 'visualizations'
                          ? 'New visualization'
                          : 'New report'}
                    </button>
                  </>
                )}
              </PageHeading>
              {page === 'overview' && (
                <>
                  <div className="overview-stats">
                    {[
                      [dashboards.length, 'Dashboards', LayoutDashboard],
                      [reports.length, 'Saved reports', FileText],
                      [visualizations.length, 'Visualizations', ChartNoAxesCombined],
                      [catalog.length, 'Connected datasets', Database],
                    ].map(([n, label, Icon]: any) => (
                      <div className="panel overview-stat" key={label}>
                        <Icon size={22} />
                        <strong>{n}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="section-heading">
                    <h2>Pick up where you left off</h2>
                    <button className="text-link" onClick={() => go('dashboards')}>
                      All dashboards
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {(page === 'dashboards' || page === 'overview') && (
                <>
                  {page !== 'overview' && (
                    <div className="list-toolbar">
                      <div className="tabs">
                        <button
                          className={!favoriteOnly ? 'active' : ''}
                          onClick={() => setFavoriteOnly(false)}
                        >
                          All dashboards <span>{dashboards.length}</span>
                        </button>
                        <button
                          className={favoriteOnly ? 'active' : ''}
                          onClick={() => setFavoriteOnly(true)}
                        >
                          <Star size={14} />
                          Favorites
                        </button>
                      </div>
                      <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Search dashboards…"
                      />
                    </div>
                  )}
                  <div className="dashboard-cards">
                    {dashboards
                      .filter(
                        (d) =>
                          d.name.toLowerCase().includes(search.toLowerCase()) &&
                          (!favoriteOnly || d.favorite),
                      )
                      .map((d) => (
                        <article className="panel dashboard-card" key={d.id}>
                          <button
                            className="dashboard-thumbnail"
                            aria-label={'Open ' + d.name}
                            onClick={() => setActiveDash(d.id)}
                          >
                            <div className="mini-kpis">
                              <i />
                              <i />
                              <i />
                            </div>
                            <div className="mini-charts">
                              <div>
                                {[35, 67, 43, 80, 56, 93].map((h, i) => (
                                  <i key={i} style={{ height: h + '%' }} />
                                ))}
                              </div>
                              <span />
                            </div>
                            <div className="mini-table" />
                          </button>
                          <div className="dashboard-card-body">
                            <div>
                              <button className="card-title" onClick={() => setActiveDash(d.id)}>
                                {d.name}
                              </button>
                              <button
                                className={'icon-btn favorite ' + (d.favorite ? 'selected' : '')}
                                aria-label="Toggle favorite"
                                disabled={!canEdit}
                                onClick={() => saveDashboard({ ...d, favorite: !d.favorite })}
                              >
                                <Star size={17} />
                              </button>
                            </div>
                            <p>{d.description || 'Your saved reports, together in one view.'}</p>
                            <div className="card-meta">
                              <span>
                                <LayoutGrid size={13} />
                                {d.widgets.length} widgets
                              </span>
                              <span>Updated {shortDate(d.updated_at)}</span>
                            </div>
                            {canEdit && (
                              <div className="card-actions">
                                <button onClick={() => duplicate('dashboards', d.id)}>
                                  <Copy size={14} />
                                  Duplicate
                                </button>
                                <button
                                  onClick={() =>
                                    setDeleteItem({ kind: 'dashboards', id: d.id, name: d.name })
                                  }
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    {!dashboards.filter(
                      (d) =>
                        d.name.toLowerCase().includes(search.toLowerCase()) &&
                        (!favoriteOnly || d.favorite),
                    ).length && (
                      <Empty
                        title="No dashboards yet"
                        description="Create a dashboard to bring your reports together."
                      />
                    )}
                  </div>
                </>
              )}
              {(page === 'reports' || page === 'overview') && (
                <>
                  {page === 'overview' ? (
                    <div className="section-heading">
                      <h2>Recent reports</h2>
                      <button className="text-link" onClick={() => go('reports')}>
                        All reports
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="list-toolbar">
                      <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Search reports…"
                      />
                      <div className="filter-selects">
                        <select
                          aria-label="Filter by dataset"
                          value={datasetFilter}
                          onChange={(e) => setDatasetFilter(e.target.value)}
                        >
                          <option value="">All datasets</option>
                          {catalog.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Filter by report type"
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value)}
                        >
                          <option value="">All types</option>
                          <option value="detail">Detail</option>
                          <option value="summary">Summary</option>
                        </select>
                        <select
                          aria-label="Filter by owner"
                          value={ownerFilter}
                          onChange={(e) => setOwnerFilter(e.target.value)}
                        >
                          <option value="">All owners</option>
                          {[...new Set(reports.map((r) => r.created_by))].map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="panel report-list">
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Dataset</th>
                            <th>Owner</th>
                            <th>Updated</th>
                            <th>Last run</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(page === 'overview'
                            ? filteredReports.slice(0, 5)
                            : filteredReports
                          ).map((r) => (
                            <tr key={r.id}>
                              <td>
                                <button className="report-name" onClick={() => openReport(r.id)}>
                                  <span className="report-icon">
                                    <FileText size={17} />
                                  </span>
                                  <span>
                                    <strong>{r.name}</strong>
                                    <small>{r.description}</small>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <span className="tag">
                                  {r.query_definition.metrics.length ? 'Summary' : 'Detail'}
                                </span>
                              </td>
                              <td>
                                {catalog.find((d) => d.id === r.query_definition.source)?.label}
                              </td>
                              <td>
                                <span className="owner">
                                  <span>{r.created_by[0]}</span>
                                  {r.created_by}
                                </span>
                              </td>
                              <td>{shortDate(r.updated_at)}</td>
                              <td>
                                {r.last_executed_at ? shortDate(r.last_executed_at) : 'Not run'}
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    className="icon-btn"
                                    aria-label={'Run ' + r.name}
                                    onClick={() => openReport(r.id)}
                                  >
                                    <ArrowUpRight size={17} />
                                  </button>
                                  {canEdit && (
                                    <>
                                      <button
                                        className="icon-btn"
                                        aria-label={'Duplicate ' + r.name}
                                        onClick={() => duplicate('reports', r.id)}
                                      >
                                        <Copy size={15} />
                                      </button>
                                      <button
                                        className="icon-btn"
                                        aria-label={'Delete ' + r.name}
                                        onClick={() =>
                                          setDeleteItem({ kind: 'reports', id: r.id, name: r.name })
                                        }
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!filteredReports.length && (
                      <Empty
                        title="No reports found"
                        description="Try another search or create a new report."
                      />
                    )}
                    <div className="list-footer">{filteredReports.length} reports</div>
                  </div>
                </>
              )}
              {page === 'visualizations' && (
                <>
                  <div className="list-toolbar">
                    <span className="muted">{visualizations.length} saved visualizations</span>
                    <SearchBox
                      value={search}
                      onChange={setSearch}
                      placeholder="Search visualizations…"
                    />
                  </div>
                  <div className="visualization-cards">
                    {visualizations
                      .filter((v) => v.name.toLowerCase().includes(search.toLowerCase()))
                      .map((v) => (
                        <article className="panel viz-card" key={v.id}>
                          <div className="viz-icon">
                            <BarChart3 size={30} />
                          </div>
                          <span className="tag">
                            {v.visualization_definition.type.replaceAll('_', ' ')}
                          </span>
                          <h3>
                            <button
                              className="card-title"
                              onClick={() => openReport(v.report_id, v)}
                            >
                              {v.name}
                            </button>
                          </h3>
                          <p>Based on {reports.find((r) => r.id === v.report_id)?.name}</p>
                          <div className="card-meta">
                            <span>{shortDate(v.updated_at)}</span>
                            <div className="row-actions">
                              <button
                                className="icon-btn"
                                aria-label={'Open ' + v.name}
                                onClick={() => openReport(v.report_id, v)}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                              {canEdit && (
                                <>
                                  <button
                                    className="icon-btn"
                                    aria-label={'Duplicate ' + v.name}
                                    onClick={() => duplicate('visualizations', v.id)}
                                  >
                                    <Copy size={15} />
                                  </button>
                                  <button
                                    className="icon-btn"
                                    aria-label={'Delete ' + v.name}
                                    onClick={() =>
                                      setDeleteItem({
                                        kind: 'visualizations',
                                        id: v.id,
                                        name: v.name,
                                      })
                                    }
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                  {!visualizations.length && (
                    <Empty
                      title="Give your data a new perspective"
                      description="Build a report, then save its visualization."
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <ShieldCheck size={19} />
          {notice}
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal === 'report' && (
        <Modal title="Create a report" onClose={() => setModal(null)}>
          <p className="modal-description">What would you like to explore?</p>
          <div className="dataset-picker">
            {catalog.map((d) => (
              <button key={d.id} onClick={() => newReport(d.id)}>
                <span className="item-icon">
                  <Database size={21} />
                </span>
                <span>
                  <strong>{d.label}</strong>
                  <small>{d.description}</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'dashboard' && (
        <Modal title="Create a dashboard" onClose={() => setModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              try {
                const d = await api<Dashboard>('/dashboards', 'POST', {
                  name: fd.get('name'),
                  description: fd.get('description'),
                  widgets: [],
                });
                await reload();
                setActiveDash(d.id);
                setPage('dashboards');
                setModal(null);
                notify('Dashboard created');
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <label>
              Name
              <input
                name="name"
                placeholder="e.g. Regional fleet overview"
                maxLength={120}
                required
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                placeholder="What will this dashboard help you understand?"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="btn primary" type="submit">
                Create dashboard
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleteItem && (
        <Modal title={'Delete ' + deleteItem.name + '?'} onClose={() => setDeleteItem(null)}>
          <p className="modal-description">
            This saved definition will be removed. Your source data will not change.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleteItem(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                try {
                  await api(`/${deleteItem.kind}/${deleteItem.id}`, 'DELETE');
                  setDeleteItem(null);
                  await reload();
                  notify('Deleted successfully');
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="A clearer view with DataTap" onClose={() => setModal(null)}>
          <div className="help-content">
            <p>
              Choose a dataset, select your fields, and filter the records you need. Switch to
              Summary to group data and calculate metrics.
            </p>
            <h3>Daily snapshots</h3>
            <p>
              Latest snapshot shows current fleet data. Historical reports can include the same
              device on multiple days. Include Snapshot Date when comparing a date range.
            </p>
            <h3>From report to dashboard</h3>
            <p>
              Save your report, select a compatible chart, and save a visualization. Add either to a
              dashboard and arrange your widgets.
            </p>
            <div className="info-box">
              {session.mode === 'demo'
                ? 'This workspace uses generated sample data for the last 30 days. Reports and dashboards are saved on this computer.'
                : 'DataTap credentials and query execution are managed securely by the application server.'}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
