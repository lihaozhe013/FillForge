import type { RunSummary } from '@fillforge/schema';
import type { Navigate } from '../App';
import { ErrorBanner, Section, StatusBadge } from '../components/ui';
import { useAsyncData } from '../hooks/useAsyncData';

export function RunsPage({ navigate }: { navigate: Navigate }) {
  const runs = useAsyncData(() => window.fillforge.runs.list(), []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Runs</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'newRun' })}>New run</button>
        </div>
      </header>

      <ErrorBanner error={runs.error} />

      <Section title={`Recent runs (${runs.data?.length ?? 0})`}>
        {runs.loading && <p className="empty-hint">Loading…</p>}
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Template</th>
              <th>Created</th>
              <th>Artifacts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((run: RunSummary) => (
              <tr key={run.id}>
                <td>
                  <code>{run.id}</code>
                </td>
                <td>{run.templateId}</td>
                <td className="muted">{new Date(run.createdAt).toLocaleString()}</td>
                <td className="artifact-chips">
                  <StatusBadge status={run.artifacts.prompt ? 'prompt' : 'no-prompt'} />
                  <StatusBadge status={run.artifacts.extraction ? 'extraction' : 'no-extraction'} />
                  <StatusBadge status={run.artifacts.review ? 'review' : 'no-review'} />
                  <StatusBadge status={run.artifacts.output ? 'output' : 'no-output'} />
                </td>
                <td>
                  <button className="link" onClick={() => navigate({ page: 'run', runId: run.id })}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(runs.data?.length ?? 0) === 0 && !runs.loading && (
          <p className="empty-hint">No runs yet.</p>
        )}
      </Section>
    </div>
  );
}
