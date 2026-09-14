import { ResultCache, cacheKey, cachePolicy } from './result-cache.mjs';
import { RequestBudget } from './request-budget.mjs';
import { migrateConnectivityReports, migrateCannedPresentation } from './report-migrations.mjs';
import express from 'express';
import {
  randomUUID,
  createHmac,
  timingSafeEqual,
  scryptSync,
  randomBytes,
  createHash,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { catalog, dataset, operators, aggregateOptions } from './catalog.mjs';
import { compile, evaluate, resultColumns } from './query.mjs';
import { makeData, seed } from './demo.mjs';
import { executeDataTap } from './datatap.mjs';
import { connectionStore, connectionCandidate } from './connections.mjs';
try {
  process.loadEnvFile();
} catch {}
const production = process.env.NODE_ENV === 'production';
const demo = process.env.DEMO_MODE === 'true' || (!production && process.env.DEMO_MODE !== 'false');
const secret = process.env.SESSION_SECRET || (!demo ? null : randomBytes(32).toString('hex'));
if (!secret || (!demo && secret.length < 32))
  throw Error('Configure a SESSION_SECRET of at least 32 characters.');
const users = JSON.parse(process.env.REPORTING_USERS || '[]');
const tenants = JSON.parse(process.env.DATATAP_TENANTS || '{}');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== `${req.protocol}://${req.get('host')}`
  )
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  next();
});
const data = demo ? makeData() : null;
const dir = path.resolve(process.env.DATA_DIR || '.data');
mkdirSync(dir, { recursive: true });
const dbfile = path.join(dir, demo ? 'demo.json' : 'reporting.json');
let db = existsSync(dbfile)
  ? JSON.parse(readFileSync(dbfile, 'utf8'))
  : demo
    ? seed()
    : { reports: [], visualizations: [], dashboards: [], audit_events: [] };
migrateConnectivityReports(db);
migrateCannedPresentation(db);
const persist = () => {
  writeFileSync(dbfile + '.tmp', JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(dbfile + '.tmp', dbfile);
};
persist();
const connections = connectionStore(dir);
function connectionFor(user) {
  const saved = connections.read(user.tenant);
  if (saved) return saved.enabled ? saved : null;
  return (
    tenants[user.tenant] ||
    (!demo && users.every((u) => u.tenant === user.tenant) && process.env.DATATAP_API_KEY
      ? { baseUrl: process.env.DATATAP_BASE_URL, apiKey: process.env.DATATAP_API_KEY }
      : null)
  );
}
const resultCache = new ResultCache();
const cacheBoot = randomUUID();
const cacheEpochs = new Map();
const budget = new RequestBudget({
  file: path.join(dir, 'request-budget.json'),
  limit: Number(process.env.DATATAP_REQUESTS_PER_HOUR || 25),
});
function cacheScope(user) {
  const connection = connectionFor(user);
  return createHash('sha256')
    .update(
      JSON.stringify([
        cacheBoot,
        user.tenant,
        user.id,
        user.role,
        connection?.baseUrl,
        connection?.updated_at,
        !!connection?.apiKey,
        cacheEpochs.get(user.tenant) || 0,
        'catalog-2026-09-14-v1',
      ]),
    )
    .digest('hex');
}
function budgetKey(user, connection) {
  return createHash('sha256')
    .update(JSON.stringify([connection?.baseUrl]))
    .digest('hex');
}
async function liveRun(q, user, connection, options = {}) {
  const key = budgetKey(user, connection);
  return budget.run(
    key,
    () =>
      executeDataTap(q, connection, {
        ...options,
        timeout: 120000,
        pollDelay: (attempt) => Math.min(30000, 10000 * (attempt + 1)),
        fetchImpl: (url, opts) => budget.request(key, url, opts),
      }),
    options.resumeQueryId ? 1 : 2,
  );
}
const modeFor = (user) => (connectionFor(user)?.apiKey ? 'live' : demo ? 'demo' : 'unconfigured');
const sign = (s) => createHmac('sha256', secret).update(s).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const demoUser = {
  id: 'demo_user',
  name: 'Alex Morgan',
  email: 'alex@example.com',
  tenant: 'demo',
  role: 'administrator',
};
function session(req) {
  if (demo) return demoUser;
  try {
    const raw = req.headers.cookie
      ?.split('; ')
      .find((s) => s.startsWith('reporting_session='))
      ?.slice(18);
    const [p, s] = raw.split('.');
    if (!safeEqual(sign(p), s)) return null;
    const token = JSON.parse(Buffer.from(p, 'base64url'));
    if (token.exp < Date.now()) return null;
    return users.find((u) => u.id === token.id && u.tenant === token.tenant) || null;
  } catch {
    return null;
  }
}
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  tenant: u.tenant,
});
const attempts = new Map();
app.post('/api/login', (req, res) => {
  const key = req.ip;
  const prior = attempts.get(key);
  if (prior && prior.until > Date.now() && prior.count >= 10)
    return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
  const u = users.find((u) => u.email === req.body.email);
  let valid = false;
  try {
    const [kind, salt, hash] = u?.passwordHash?.split(':') || [];
    valid =
      kind === 'scrypt' &&
      safeEqual(scryptSync(String(req.body.password), salt, 64).toString('hex'), hash);
  } catch {}
  if (!valid) {
    attempts.set(key, {
      count: prior?.until > Date.now() ? prior.count + 1 : 1,
      until: Date.now() + 900000,
    });
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  attempts.delete(key);
  const p = Buffer.from(
    JSON.stringify({ id: u.id, tenant: u.tenant, exp: Date.now() + 8 * 3600000 }),
  ).toString('base64url');
  res.cookie('reporting_session', `${p}.${sign(p)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: production,
    maxAge: 8 * 3600000,
  });
  res.json({ user: publicUser(u) });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('reporting_session');
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => {
  req.user = session(req);
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
});
app.get('/api/session', (req, res) =>
  res.json({ user: publicUser(req.user), mode: modeFor(req.user), localWorkspace: demo }),
);
app.get('/api/cache/context', (req, res) =>
  res.json({ namespace: cacheScope(req.user), server_time: new Date().toISOString() }),
);
app.post('/api/cache/prepare', (req, res) => {
  const preview = req.body.preview === true;
  const c = compile(req.body.query, preview);
  const namespace = cacheScope(req.user);
  res.json({
    namespace,
    key: cacheKey(namespace, c.definition, preview),
    policy: cachePolicy(c.definition, Date.now(), process.env.BROWSER_CACHE_SENSITIVE === 'true'),
    server_time: new Date().toISOString(),
  });
});
app.delete('/api/cache', (req, res) => {
  resultCache.clear(cacheScope(req.user));
  cacheEpochs.set(req.user.tenant, (cacheEpochs.get(req.user.tenant) || 0) + 1);
  res.json({ ok: true });
});
app.get('/api/reporting/datasets', (req, res) =>
  res.json({
    datasets: catalog,
    operators,
    aggregations: Object.fromEntries(
      ['string', 'number', 'date', 'boolean'].map((t) => [t, aggregateOptions(t)]),
    ),
  }),
);
app.get('/api/reporting/datasets/:id', (req, res) => res.json(dataset(req.params.id)));
app.get('/api/reporting/datasets/:id/fields', (req, res) =>
  res.json(dataset(req.params.id).fields),
);
const find = (kind, id, user) => {
  const r = db[kind].find((r) => r.id === id && r.tenant === user.tenant);
  if (!r) {
    const e = Error('This item was not found.');
    e.status = 404;
    throw e;
  }
  return r;
};
const edit = (req, res, next) =>
  ['analyst', 'administrator'].includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'An analyst role is required to make changes.' });
const audit = (req, action, id) => {
  db.audit_events.push({
    id: randomUUID(),
    tenant: req.user.tenant,
    user: req.user.id,
    action,
    resource_id: id,
    at: new Date().toISOString(),
  });
  db.audit_events = db.audit_events.slice(-5000);
};
const administrator = (req, res, next) =>
  req.user.role === 'administrator'
    ? next()
    : res.status(403).json({ error: 'Administrator access is required to configure DataTap.' });
function connectionStatus(user) {
  const connection = connectionFor(user);
  return {
    tenant:
      connection?.tenant ||
      connection?.baseUrl?.match(/^https:\/\/([a-z0-9-]+)-api\.esper\.cloud/)?.[1] ||
      '',
    baseUrl: connection?.baseUrl || '',
    hasApiKey: !!connection?.apiKey,
    mode: modeFor(user),
    source: connections.read(user.tenant) ? 'settings' : connection ? 'environment' : 'none',
    updated_at: connection?.updated_at || null,
    canUseSampleData: demo,
  };
}
app.get('/api/connection', administrator, (req, res) => res.json(connectionStatus(req.user)));
const connectionTests = new Set();
async function verifyConnection(req, res, next) {
  if (connectionTests.has(req.user.tenant))
    return res.status(429).json({ error: 'A connection test is already running. Please wait.' });
  connectionTests.add(req.user.tenant);
  try {
    req.connection = connectionCandidate(req.body, connectionFor(req.user));
    await liveRun(
      {
        source: 'devices',
        data_scope: { type: 'LATEST' },
        columns: ['device_id'],
        filters: [],
        group_by: [],
        metrics: [],
        sort: [],
        related: [],
        limit: 1,
      },
      req.user,
      req.connection,
      { preview: true },
    );
    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    connectionTests.delete(req.user.tenant);
  }
}
app.post('/api/connection/test', administrator, verifyConnection, (req, res) =>
  res.json({ ok: true, message: 'DataTap connection verified.' }),
);
app.put('/api/connection', administrator, verifyConnection, (req, res) => {
  connections.write(req.user.tenant, req.connection);
  for (const [id, execution] of executions)
    if (execution.tenant === req.user.tenant) executions.delete(id);
  audit(req, 'connection_updated', req.user.tenant);
  persist();
  res.json(connectionStatus(req.user));
});
app.delete('/api/connection', administrator, (req, res) => {
  connections.write(req.user.tenant, null);
  for (const [id, execution] of executions)
    if (execution.tenant === req.user.tenant) executions.delete(id);
  audit(req, 'connection_removed', req.user.tenant);
  persist();
  res.json(connectionStatus(req.user));
});
function clean(kind, b, user) {
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120)
    throw Error('Enter a name of up to 120 characters.');
  const out = {
    name: b.name.trim(),
    description: String(b.description || '').slice(0, 2000),
    favorite: !!b.favorite,
  };
  if (kind === 'reports') out.query_definition = compile(b.query_definition).definition;
  if (kind === 'visualizations') {
    const report = find('reports', b.report_id, user);
    const v = b.visualization_definition;
    const q = report.query_definition;
    const types = [
      'table',
      'bar',
      'horizontal_bar',
      'stacked_bar',
      'line',
      'area',
      'pie',
      'donut',
      'kpi',
    ];
    if (!v || !types.includes(v.type)) throw Error('Choose a visualization type.');
    const columns = resultColumns(q);
    if (v.type !== 'table') {
      if (
        !q.metrics.length ||
        !Array.isArray(v.measures) ||
        !v.measures.length ||
        v.measures.some((id) => !columns.some((c) => c.id === id && c.type === 'number'))
      )
        throw Error('This graph requires a numeric measure.');
      if (v.type === 'kpi' && (q.group_by.length || v.measures.length !== 1))
        throw Error('KPI requires one metric and no grouping.');
      if (v.type !== 'kpi' && !q.group_by.includes(v.dimension))
        throw Error('Choose a category dimension.');
      if (['pie', 'donut'].includes(v.type) && (q.group_by.length !== 1 || v.measures.length !== 1))
        throw Error('Pie charts require one dimension and one measure.');
      if (
        ['line', 'area'].includes(v.type) &&
        !columns.some((c) => c.id === v.dimension && ['date', 'number'].includes(c.type))
      )
        throw Error('Line and area charts require a date or numeric dimension.');
    }
    out.report_id = b.report_id;
    out.visualization_definition = v;
  }
  if (kind === 'dashboards') {
    if (!Array.isArray(b.widgets) || b.widgets.length > 40)
      throw Error('A dashboard supports up to 40 widgets.');
    const ids = new Set();
    out.widgets = b.widgets.map((w) => {
      if (
        !['report', 'visualization'].includes(w.type) ||
        typeof w.id !== 'string' ||
        ids.has(w.id)
      )
        throw Error('Invalid widget.');
      ids.add(w.id);
      find(w.type === 'report' ? 'reports' : 'visualizations', w.resource_id, user);
      return {
        id: w.id,
        type: w.type,
        resource_id: w.resource_id,
        layout: {
          width: Math.min(12, Math.max(3, Number(w.layout?.width) || 6)),
          height: Math.min(8, Math.max(2, Number(w.layout?.height) || 4)),
        },
      };
    });
  }
  return out;
}
for (const kind of ['reports', 'visualizations', 'dashboards']) {
  app.get(`/api/${kind}`, (req, res) =>
    res.json(db[kind].filter((r) => r.tenant === req.user.tenant)),
  );
  app.get(`/api/${kind}/:id`, (req, res) => res.json(find(kind, req.params.id, req.user)));
  app.post(`/api/${kind}`, edit, (req, res) => {
    const now = new Date().toISOString();
    const r = {
      ...clean(kind, req.body, req.user),
      id: randomUUID(),
      tenant: req.user.tenant,
      created_by: req.user.name,
      created_at: now,
      updated_at: now,
    };
    db[kind].push(r);
    audit(req, 'create', r.id);
    persist();
    res.status(201).json(r);
  });
  app.put(`/api/${kind}/:id`, edit, (req, res) => {
    const r = find(kind, req.params.id, req.user);
    Object.assign(r, clean(kind, req.body, req.user), { updated_at: new Date().toISOString() });
    audit(req, 'update', r.id);
    persist();
    res.json(r);
  });
  app.delete(`/api/${kind}/:id`, edit, (req, res) => {
    const r = find(kind, req.params.id, req.user);
    if (
      kind === 'reports' &&
      (db.visualizations.some((v) => v.report_id === r.id) ||
        db.dashboards.some((d) =>
          d.widgets.some((w) => w.type === 'report' && w.resource_id === r.id),
        ))
    )
      return res
        .status(409)
        .json({ error: 'Remove this report from its visualizations and dashboards first.' });
    if (
      kind === 'visualizations' &&
      db.dashboards.some((d) =>
        d.widgets.some((w) => w.type === 'visualization' && w.resource_id === r.id),
      )
    )
      return res
        .status(409)
        .json({ error: 'Remove this visualization from its dashboards first.' });
    db[kind] = db[kind].filter((x) => x !== r);
    audit(req, 'delete', r.id);
    persist();
    res.json({ ok: true });
  });
  app.post(`/api/${kind}/:id/duplicate`, edit, (req, res) => {
    const r = find(kind, req.params.id, req.user);
    const copy = {
      ...structuredClone(r),
      id: randomUUID(),
      name: `${r.name} (copy)`,
      created_by: req.user.name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db[kind].push(copy);
    audit(req, 'duplicate', copy.id);
    persist();
    res.status(201).json(copy);
  });
}
const executions = new Map();
setInterval(() => {
  for (const [id, x] of executions) if (Date.now() - x.started > 3600000) executions.delete(id);
}, 60000).unref();

function execute(q, user, preview = false, reportId, intent = 'default') {
  if (!['default', 'revalidate'].includes(intent)) throw Error('Invalid cache intent.');
  const c = compile(q, preview),
    namespace = cacheScope(user),
    key = cacheKey(namespace, c.definition, preview);
  const entry = resultCache.get(namespace, key);
  const policy = cachePolicy(
    c.definition,
    Date.now(),
    process.env.BROWSER_CACHE_SENSITIVE === 'true',
  );
  const createExecution = () => {
    const id = randomUUID();
    const e = {
      id,
      execution_id: id,
      tenant: user.tenant,
      namespace,
      status: 'queued',
      started: Date.now(),
      query_hash: createHash('sha256').update(c.query).digest('hex'),
      query: c.query,
      latest_data: c.latest_data,
      requesting_user: user.id,
      report_id: reportId,
    };
    executions.set(id, e);
    return e;
  };
  const apply = (e, result, cache) =>
    Object.assign(e, result, {
      columns: resultColumns(c.definition),
      cache,
      status: 'complete',
      completed_at: new Date().toISOString(),
    });
  const record = (e) => {
    db.audit_events.push({
      id: randomUUID(),
      tenant: user.tenant,
      user: user.id,
      action: 'execute',
      resource_id: reportId,
      execution_id: e.id,
      query_hash: e.query_hash,
      datatap_query_id: e.datatap_query_id,
      status: e.status,
      row_count: e.metadata?.row_count,
      cache_source: e.cache?.source,
      at: e.completed_at,
    });
    db.audit_events = db.audit_events.slice(-5000);
    persist();
  };
  if (entry && entry.expiresAt > Date.now() && intent === 'default') {
    const e = createExecution();
    apply(e, entry.result, resultCache.envelope(entry));
    record(e);
    return { execution_id: e.id, status: e.status };
  }
  if (
    [...executions.values()].filter(
      (e) => e.tenant === user.tenant && ['queued', 'running'].includes(e.status),
    ).length >= 20
  )
    throw Error('Too many reports are running. Try again shortly.');
  const e = createExecution(),
    executionConnection = connectionFor(user);
  let pending = resultCache.pending.get(key);
  if (!pending) {
    const canonical = {
      ...c.definition,
      labels: {},
      metrics: c.definition.metrics.map(({ label, ...m }) => m),
    };
    pending = (async () => {
      const resume = resultCache.resume.get(key);
      const result =
        executionConnection?.apiKey || !demo
          ? await liveRun(canonical, user, executionConnection, {
              preview,
              resumeQueryId: resume?.id,
              onQueryId: (id) => resultCache.resume.set(key, { namespace, id }),
            })
          : evaluate(canonical, data, preview);
      resultCache.resume.delete(key);
      if (cacheScope(user) !== namespace)
        throw Error('Connection or permissions changed. Run the report again.');
      const saved = resultCache.put(namespace, key, result, policy);
      const cache = saved
        ? resultCache.envelope(saved, 'upstream')
        : {
            namespace,
            key,
            source: 'upstream',
            state: 'fresh',
            persist_allowed: false,
            browser_cache_allowed: false,
          };
      return { result, cache };
    })();
    resultCache.pending.set(key, pending);
    pending.then(
      () => resultCache.pending.delete(key),
      (err) => {
        resultCache.pending.delete(key);
        if (
          !['TIMED_OUT', 'RATE_LIMITED', 'NETWORK_ERROR', 'UPSTREAM_ERROR'].includes(err.statusCode)
        )
          resultCache.resume.delete(key);
        if (err.statusCode === 'AUTHORIZATION_FAILED') {
          resultCache.clear(namespace);
          cacheEpochs.set(user.tenant, (cacheEpochs.get(user.tenant) || 0) + 1);
        }
      },
    );
  }
  e.status = 'running';
  pending.then(
    ({ result, cache }) => {
      apply(e, result, cache);
      record(e);
    },
    (err) => {
      Object.assign(e, {
        status: 'failed',
        error: err.message,
        failure_state: err.statusCode || 'FAILED',
        retry_not_before: err.retryNotBefore ? new Date(err.retryNotBefore).toISOString() : null,
        completed_at: new Date().toISOString(),
      });
      record(e);
    },
  );
  if (entry) {
    const stale = createExecution();
    apply(stale, entry.result, { ...resultCache.envelope(entry), refresh_execution_id: e.id });
    record(stale);
    return { execution_id: stale.id, status: 'complete' };
  }
  return { execution_id: e.id, status: e.status };
}
app.post('/api/reporting/query/compile', (req, res) => res.json(compile(req.body)));
for (const action of ['preview', 'execute'])
  app.post(`/api/reporting/query/${action}`, (req, res) =>
    res
      .status(202)
      .json(
        execute(
          req.body,
          req.user,
          action === 'preview',
          undefined,
          req.get('X-Report-Cache-Intent') || 'default',
        ),
      ),
  );
app.get('/api/reporting/executions/:id', (req, res) => {
  const e = executions.get(req.params.id);
  if (
    !e ||
    e.tenant !== req.user.tenant ||
    e.requesting_user !== req.user.id ||
    e.namespace !== cacheScope(req.user)
  )
    return res.status(404).json({ error: 'Execution not found.' });
  res.json(e);
});
app.post('/api/reports/:id/execute', (req, res) => {
  const r = find('reports', req.params.id, req.user);
  const e = execute(
    r.query_definition,
    req.user,
    false,
    r.id,
    req.get('X-Report-Cache-Intent') || 'default',
  );
  r.last_executed_at = new Date().toISOString();
  persist();
  res.status(202).json(e);
});
app.post('/api/dashboards/:id/execute', (req, res) => {
  const d = find('dashboards', req.params.id, req.user);
  const runs = {};
  res.status(202).json(
    d.widgets.map((w) => {
      try {
        const r =
          w.type === 'report'
            ? find('reports', w.resource_id, req.user)
            : find('reports', find('visualizations', w.resource_id, req.user).report_id, req.user);
        runs[r.id] ||= execute(
          r.query_definition,
          req.user,
          false,
          r.id,
          req.get('X-Report-Cache-Intent') || 'default',
        );
        return { widget_id: w.id, ...runs[r.id] };
      } catch (e) {
        return { widget_id: w.id, status: 'failed', error: e.message };
      }
    }),
  );
});
app.get('/api/audit-events', (req, res) => {
  if (req.user.role !== 'administrator')
    return res.status(403).json({ error: 'Administrator access is required.' });
  res.json(db.audit_events.filter((e) => e.tenant === req.user.tenant).slice(-200));
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((err, req, res, next) => {
  res.status(err.status || 400).json({ error: err.message || 'Unable to complete this request.' });
});
if (production) {
  app.use(express.static('dist'));
  app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () =>
  console.log(`DataTap Reporting (${demo ? 'demo' : 'live'}): http://localhost:${port}`),
);
