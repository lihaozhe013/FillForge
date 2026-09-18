import type { RunSummary, TemplateSummary } from '@fillforge/schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';
import { formatDateTime } from '../lib/i18n';

export function HomePage({ navigate }: { navigate: Navigate }) {
  const { t } = useTranslation();
  const templates = useAsyncData(() => window.fillforge.templates.list(), []);
  const runs = useAsyncData(() => window.fillforge.runs.list(), []);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);

  const error = actionError ?? templates.error ?? runs.error;
  const recentRuns: RunSummary[] = (runs.data ?? []).slice(0, 5);

  async function importTemplate() {
    try {
      setActionError(null);
      await window.fillforge.templates.import();
      templates.reload();
    } catch (cause) {
      setActionError(extractError(cause));
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('home.title')}</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'templates' })}>{t('nav.templates')}</button>
          <button className="primary" onClick={() => void importTemplate()}>
            {t('home.importTemplate')}
          </button>
        </div>
      </header>

      <ErrorBanner error={error} />

      <div className="grid-2">
        <Section title={t('home.templatesCount', { total: templates.data?.length ?? 0 })}>
          {templates.loading && <p className="empty-hint">{t('common.loading')}</p>}
          <ul className="list">
            {(templates.data ?? []).map((template: TemplateSummary) => (
              <li key={template.id}>
                <button
                  className="link"
                  onClick={() =>
                    navigate({
                      page: 'templateEditor',
                      templateId: template.id
                    })
                  }
                >
                  {template.name}
                </button>
                <span className="muted"> {template.id}</span>
              </li>
            ))}
          </ul>
          {(templates.data?.length ?? 0) === 0 && !templates.loading && (
            <p className="empty-hint">{t('home.emptyTemplates')}</p>
          )}
        </Section>

        <Section
          title={t('home.recentRuns')}
          actions={
            <button className="link" onClick={() => navigate({ page: 'runs' })}>
              {t('home.viewAll')}
            </button>
          }
        >
          {runs.loading && <p className="empty-hint">{t('common.loading')}</p>}
          <ul className="list">
            {recentRuns.map((run) => (
              <li key={run.id}>
                <button className="link" onClick={() => navigate({ page: 'run', runId: run.id })}>
                  {run.id}
                </button>
                <span className="muted">
                  {' '}
                  · {run.templateId} · {formatDateTime(run.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {recentRuns.length === 0 && !runs.loading && (
            <p className="empty-hint">{t('home.emptyRuns')}</p>
          )}
        </Section>
      </div>

      <Section title={t('home.workflow')}>
        <ol className="workflow">
          <li>{t('home.workflow1')}</li>
          <li>{t('home.workflow2')}</li>
          <li>{t('home.workflow3')}</li>
          <li>{t('home.workflow4')}</li>
          <li>{t('home.workflow5')}</li>
        </ol>
      </Section>
    </div>
  );
}
