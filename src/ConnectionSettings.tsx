import { useEffect, useState } from 'react';
import { CheckCircle2, Database, KeyRound, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import { api } from './api';
import { ErrorState, Loading, Modal, PageHeading } from './components';
type Status = {
  tenant: string;
  baseUrl: string;
  hasApiKey: boolean;
  mode: string;
  source: string;
  updated_at: string | null;
  canUseSampleData: boolean;
};
export default function ConnectionSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tenant, setTenant] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [disconnect, setDisconnect] = useState(false);
  async function load() {
    setError('');
    try {
      const current = await api<Status>('/connection');
      setStatus(current);
      setTenant(current.tenant);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit(action: 'test' | 'save') {
    setBusy(action);
    setError('');
    setSuccess('');
    try {
      await api(
        '/connection' + (action === 'test' ? '/test' : ''),
        action === 'test' ? 'POST' : 'PUT',
        { tenant, apiKey },
      );
      if (action === 'save') {
        setApiKey('');
        window.location.reload();
      } else
        setSuccess('Connection verified. Save to use live data in your reports and dashboards.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (!status) return error ? <ErrorState error={error} retry={load} /> : <Loading />;
  const canKeepKey = status.hasApiKey && tenant.trim().toLowerCase() === status.tenant;
  const valid =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(tenant.trim()) &&
    (!!apiKey.trim() || canKeepKey);
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE SETTINGS"
        title="DataTap connection"
        description="Connect your Esper tenant to explore live fleet data."
      />
      <div className="connection-settings panel">
        <div className="connection-heading">
          <span className="item-icon">
            <Database size={24} />
          </span>
          <div>
            <h2>Esper DataTap</h2>
            <p>
              {status.mode === 'live'
                ? `Using live data from ${status.tenant || 'your configured endpoint'}.`
                : status.canUseSampleData
                  ? 'You’re currently exploring sample data.'
                  : 'Connect a tenant to run your reports.'}
            </p>
          </div>
          <span className="tag">
            {status.mode === 'live'
              ? 'Live data'
              : status.canUseSampleData
                ? 'Sample data'
                : 'Not connected'}
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit('save');
          }}
        >
          <fieldset disabled={!!busy}>
            <label>
              Esper tenant
              <input
                name="tenant"
                value={tenant}
                placeholder="acme"
                required
                autoComplete="off"
                spellCheck={false}
                maxLength={63}
                onChange={(e) => {
                  setTenant(e.target.value);
                  setSuccess('');
                }}
              />
              <small>The name before .esper.cloud in your console URL. Enter the name only.</small>
            </label>
            <div className="endpoint-preview">
              https://<strong>{tenant.trim().toLowerCase() || '{tenant}'}</strong>
              -api.esper.cloud/api/data-tap/v0
            </div>
            <label>
              <span>
                <KeyRound size={15} />
                API key
              </span>
              <input
                name="apiKey"
                type="password"
                value={apiKey}
                placeholder={
                  canKeepKey ? 'Key saved — leave blank to keep it' : 'Enter your Esper API key'
                }
                required={!canKeepKey}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={8192}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSuccess('');
                }}
              />
              <small>
                {canKeepKey
                  ? 'Enter a new key only if you want to replace the saved key.'
                  : 'Use an API key with access to DataTap for this tenant.'}
              </small>
            </label>
            <div className="info-box">
              <ShieldCheck size={17} />
              <span>
                Your key is encrypted on the server. Saved keys are never returned to the browser.
                Connecting replaces sample results with live query results.
              </span>
            </div>
            {error && (
              <p className="connection-error" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="connection-success" role="status">
                <CheckCircle2 size={17} />
                {success}
              </p>
            )}
            {busy && (
              <p className="connection-progress" role="status">
                <LoaderCircle className="spin" size={17} />
                {busy === 'disconnect'
                  ? 'Disconnecting…'
                  : 'Checking DataTap access. This may take up to a minute…'}
              </p>
            )}
            <div className="connection-actions">
              <button
                className="btn"
                type="button"
                disabled={!valid || !!busy}
                onClick={() => void submit('test')}
              >
                Test connection
              </button>
              <button className="btn primary" type="submit" disabled={!valid || !!busy}>
                {busy === 'save' ? 'Connecting…' : 'Save & use live data'}
              </button>
            </div>
          </fieldset>
        </form>
        {status.hasApiKey && (
          <div className="connection-disconnect">
            <div>
              <h3>{status.canUseSampleData ? 'Return to sample data' : 'Disconnect DataTap'}</h3>
              <p>Remove the active connection. Your saved reports and dashboards will remain.</p>
            </div>
            <button className="btn" disabled={!!busy} onClick={() => setDisconnect(true)}>
              <Unplug size={15} />
              Disconnect
            </button>
          </div>
        )}
      </div>
      {disconnect && (
        <Modal title="Disconnect DataTap?" onClose={() => !busy && setDisconnect(false)}>
          <p className="modal-description">
            {status.canUseSampleData
              ? 'The workspace will return to sample data.'
              : 'Reports will stop running until a tenant is connected.'}{' '}
            Your saved report definitions will stay available.
          </p>
          <div className="modal-actions">
            <button className="btn" disabled={!!busy} onClick={() => setDisconnect(false)}>
              Cancel
            </button>
            <button
              className="btn danger"
              disabled={!!busy}
              onClick={async () => {
                setBusy('disconnect');
                try {
                  await api('/connection', 'DELETE');
                  window.location.reload();
                } catch (e) {
                  setError((e as Error).message);
                  setDisconnect(false);
                  setBusy('');
                }
              }}
            >
              Disconnect
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
