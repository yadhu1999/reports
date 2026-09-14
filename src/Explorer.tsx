import { useCacheView } from './cache-status';
import { useEffect, useState } from 'react';
import { ArrowRight, Braces, Database, Plus, Table2 } from 'lucide-react';
import { run } from './api';
import type { Dataset, Result } from './types';
import { DataTable, Empty, ErrorState, Loading, PageHeading, SearchBox } from './components';
export default function Explorer({
  datasets,
  onBuild,
}: {
  datasets: Dataset[];
  onBuild: (id: string) => void;
}) {
  const [id, setId] = useState(datasets[0]?.id || 'devices');
  const [tab, setTab] = useState('data');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const wake = useCacheView(setResult);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const dataset = datasets.find((d) => d.id === id);
  useEffect(() => {
    if (!dataset) return;
    const controller = new AbortController();
    setResult(null);
    setError('');
    run(
      {
        source: id,
        data_scope: { type: 'LATEST' },
        columns: dataset.fields.filter((f) => !f.legacy).map((f) => f.id),
        filters: [],
        metrics: [],
        group_by: [],
        sort: [],
        related: [],
        labels: {},
        limit: 100,
      },
      true,
      controller.signal,
      false,
      (r) => {
        if (!controller.signal.aborted) setResult(r);
      },
    )
      .then((r) => {
        if (!controller.signal.aborted) setResult(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, retry, wake]);
  return (
    <>
      <PageHeading
        eyebrow="DISCOVER YOUR DATA"
        title="Data explorer"
        description="Get to know the data behind your next insight."
      >
        <button className="btn primary" onClick={() => onBuild(id)}>
          <Plus size={16} />
          Build report from this data
        </button>
      </PageHeading>
      <div className="explorer-grid">
        <aside className="panel explorer-datasets">
          <h3>
            Datasets<span>{datasets.length}</span>
          </h3>
          {datasets.map((d) => (
            <button
              key={d.id}
              className={id === d.id ? 'active' : ''}
              onClick={() => {
                setId(d.id);
                setSearch('');
              }}
            >
              <Database size={18} />
              <span>
                <strong>{d.label}</strong>
                <small>{d.fields.filter((f) => !f.legacy).length} fields</small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))}
        </aside>
        <section className="panel explorer-main">
          <div className="explorer-heading">
            <div>
              <h2>{dataset?.label}</h2>
              <p>{dataset?.description}</p>
            </div>
            <span className="tag">Latest snapshot</span>
          </div>
          <div className="explorer-toolbar">
            <div className="tabs">
              <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>
                <Table2 size={15} />
                Data
              </button>
              <button className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')}>
                <Braces size={15} />
                Schema
              </button>
            </div>
            {tab === 'schema' && (
              <SearchBox value={search} onChange={setSearch} placeholder="Search fields…" />
            )}
          </div>
          {tab === 'schema' ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset?.fields
                    .filter(
                      (f) =>
                        !f.legacy && (f.id + f.label).toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((f) => (
                      <tr key={f.id}>
                        <td>
                          <code>{f.id}</code>
                        </td>
                        <td>{f.label}</td>
                        <td>
                          <span className="tag">{f.type}</span>
                        </td>
                        <td>{f.description}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <ErrorState error={error} retry={() => setRetry((n) => n + 1)} />
          ) : !result ? (
            <Loading />
          ) : (
            <DataTable result={result} />
          )}
        </section>
      </div>
    </>
  );
}
