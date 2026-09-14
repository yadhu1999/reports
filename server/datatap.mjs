import { compile, resultColumns } from './query.mjs';
import { liveWarnings } from './live-fields.mjs';
export async function executeDataTap(
  query,
  connection,
  {
    preview = false,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    timeout = 60000,
    resumeQueryId,
    onQueryId = () => {},
    pollDelay = () => 1000,
  } = {},
) {
  const compiled = compile(query, preview);
  const warnings = liveWarnings(compiled.definition);
  if (!connection?.apiKey) throw Error('DataTap connection is not configured for this workspace.');
  const base = (connection.baseUrl || 'https://develop-api.esper.cloud/api/data-tap/v0').replace(
    /\/$/,
    '',
  );
  if (!base.startsWith('https://')) throw Error('DataTap requires a secure endpoint.');
  const headers = {
    Authorization: `Bearer ${connection.apiKey}`,
    'Content-Type': 'application/json',
  };
  const deadline = now() + timeout;
  const request = async (url, options) => {
    try {
      return await fetchImpl(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - now()))),
      });
    } catch (error) {
      if (error.statusCode) throw error;
      const failure = Error('Unable to reach DataTap. Please try again.');
      failure.statusCode = 'NETWORK_ERROR';
      throw failure;
    }
  };
  const checkRateLimit = async (response) => {
    if (response.status !== 429) return;
    // Extract only an allowlisted quota description, never echo upstream errors.
    const body = await response.json().catch(() => ({}));
    const quota = String(body?.message || '').match(
      /Tenant rate limit exceeded: (\d{1,9}) requests per (second|minute|hour|day)\b/i,
    );
    const retry = response.headers?.get?.('retry-after');
    const delay = retry && /^\d{1,6}$/.test(retry) ? Number(retry) : null;
    const error = Error(
      `DataTap's tenant request limit has been reached${quota ? ` (${quota[1]} requests per ${quota[2].toLowerCase()})` : ''}. ${delay ? `Try again after ${delay} seconds.` : 'Try again after the limit resets; DataTap did not provide a reset time.'}`,
    );
    error.retryNotBefore = now() + (delay ? delay * 1000 : 3600000);
    error.statusCode = 'RATE_LIMITED';
    throw error;
  };
  const submit = resumeQueryId
    ? await request(`${base}/queries/${encodeURIComponent(resumeQueryId)}`, { headers })
    : await request(`${base}/queries/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: compiled.query, latest_data: compiled.latest_data }),
      });
  await checkRateLimit(submit);
  if ([401, 403].includes(submit.status)) {
    const error = Error(
      'DataTap rejected this API key. Check the tenant, key, and DataTap permissions.',
    );
    error.statusCode = 'AUTHORIZATION_FAILED';
    throw error;
  }
  if (!submit.ok)
    throw Error(
      'Unable to submit this report to DataTap. Check that DataTap is enabled for this tenant.',
    );
  const readPayload = async (response) => {
    try {
      const body = await response.json();
      const content = body?.content;
      return {
        id: content?.id ?? content?.query_id ?? body?.id ?? body?.query_id,
        status: content?.status ?? body?.status,
        result: content && Object.hasOwn(content, 'result') ? content.result : body?.result,
      };
    } catch {
      throw Error('DataTap returned an unexpected response.');
    }
  };
  let payload = await readPayload(submit);
  const queryId = payload.id || payload.query_id;
  if (!queryId) throw Error('DataTap did not return a query identifier.');
  onQueryId(queryId);
  let attempt = 0;
  while (now() < deadline) {
    if (['SUCCEEDED', 'SUCCESS'].includes(payload.status)) {
      // DataTap returns result:null for successful queries with no matching rows.
      const raw = payload.result === null ? [] : payload.result?.data_array;
      if (!Array.isArray(raw) || raw.some((r) => !Array.isArray(r)))
        throw Error('DataTap returned an unexpected result.');
      const columns = resultColumns(compiled.definition);
      if (raw.some((r) => r.length !== columns.length))
        throw Error('DataTap returned unexpected columns.');
      const rows = raw.slice(0, compiled.definition.limit).map((row) =>
        row.map((value, i) => {
          if (value === null) return null;
          if (columns[i].type === 'number') {
            const n = Number(value);
            if (value === '' || !Number.isFinite(n))
              throw Error('DataTap returned an invalid numeric value.');
            return n;
          }
          return value;
        }),
      );
      return {
        columns,
        rows,
        metadata: {
          row_count: rows.length,
          truncated: payload.result?.truncated === true || raw.length > compiled.definition.limit,
          limit_reached: rows.length === compiled.definition.limit,
          executed_at: new Date(now()).toISOString(),
          mode: 'live',
          warnings,
        },
        datatap_query_id: queryId,
      };
    }
    if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(payload.status))
      throw Error('DataTap was unable to complete this report.');
    await sleep(Math.min(pollDelay(attempt++), Math.max(0, deadline - now())));
    if (now() >= deadline) break;
    const response = await request(`${base}/queries/${encodeURIComponent(queryId)}`, { headers });
    await checkRateLimit(response);
    if ([401, 403].includes(response.status)) {
      const error = Error('DataTap authorization changed. Check the connection.');
      error.statusCode = 'AUTHORIZATION_FAILED';
      throw error;
    }
    if (!response.ok) {
      const error = Error('Unable to retrieve the report status.');
      error.statusCode = 'UPSTREAM_ERROR';
      throw error;
    }
    payload = await readPayload(response);
  }
  const error = Error('DataTap is taking longer than expected. Try again.');
  error.statusCode = 'TIMED_OUT';
  throw error;
}
