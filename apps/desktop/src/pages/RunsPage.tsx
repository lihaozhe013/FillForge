import type { RunSummary } from '@fillforge/schema';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section, StatusBadge } from '../components/ui';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDateTime } from '../lib/i18n';

export function RunsPage({ navigate }: { navigate: Navigate }) {
  const { t } = useTranslation();
  const runs = useAsyncData(() => window.fillforge.runs.list(), []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('runs.title')}</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'newRun' })}>{t('common.newRun')}</button>
        </div>
      </header>

      <ErrorBanner error={runs.error} />

      <Section title={t('runs.recentCount', { total: runs.data?.length ?? 0 })}>
        {runs.loading && <p className="empty-hint">{t('common.loading')}</p>}
        <table className="table">
          <thead>
            <tr>
              <th>{t('runs.colRun')}</th>
              <th>{t('runs.colTemplate')}</th>
              <th>{t('runs.colCreated')}</th>
              <th>{t('runs.colArtifacts')}</th>
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
                <td className="muted">{formatDateTime(run.createdAt)}</td>
                <td className="artifact-chips">
                  <StatusBadge status={run.artifacts.prompt ? 'prompt' : 'no-prompt'} />
                  <StatusBadge status={run.artifacts.extraction ? 'extraction' : 'no-extraction'} />
                  <StatusBadge status={run.artifacts.review ? 'review' : 'no-review'} />
                  <StatusBadge status={run.artifacts.output ? 'output' : 'no-output'} />
                </td>
                <td>
                  <button className="link" onClick={() => navigate({ page: 'run', runId: run.id })}>
                    {t('common.open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(runs.data?.length ?? 0) === 0 && !runs.loading && (
          <p className="empty-hint">{t('runs.empty')}</p>
        )}
      </Section>
    </div>
  );
}
