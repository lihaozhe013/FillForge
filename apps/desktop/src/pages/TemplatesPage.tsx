import type { TemplateSummary } from '@fillforge/schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';

export function TemplatesPage({ navigate }: { navigate: Navigate }) {
  const { t } = useTranslation();
  const templates = useAsyncData(() => window.fillforge.templates.list(), []);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      templates.reload();
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('templates.title')}</h1>
        <div className="page-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => window.fillforge.templates.import())}
          >
            {t('templates.importDocx')}
          </button>
          <button onClick={() => navigate({ page: 'newRun' })}>{t('common.newRun')}</button>
        </div>
      </header>

      <ErrorBanner error={error ?? templates.error} />

      <Section title={t('templates.availableCount', { total: templates.data?.length ?? 0 })}>
        {templates.loading && <p className="empty-hint">{t('common.loading')}</p>}
        <table className="table">
          <thead>
            <tr>
              <th>{t('templates.colName')}</th>
              <th>{t('templates.colId')}</th>
              <th>{t('templates.colDescription')}</th>
              <th>{t('templates.colDocument')}</th>
              <th>{t('templates.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(templates.data ?? []).map((template: TemplateSummary) => (
              <tr key={template.id}>
                <td>{template.name}</td>
                <td className="muted">{template.id}</td>
                <td className="muted">{template.description ?? '—'}</td>
                <td>{template.hasDocument ? '✓' : t('templates.documentMissing')}</td>
                <td className="actions-cell">
                  <button
                    className="link"
                    onClick={() => navigate({ page: 'templateEditor', templateId: template.id })}
                  >
                    {t('common.open')}
                  </button>
                  <button
                    className="link"
                    onClick={() => navigate({ page: 'newRun', templateId: template.id })}
                  >
                    {t('common.newRun')}
                  </button>
                  <button
                    className="link"
                    disabled={busy}
                    onClick={() =>
                      void run(() => window.fillforge.templates.duplicate(template.id))
                    }
                  >
                    {t('templates.duplicate')}
                  </button>
                  <button
                    className="link danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t('templates.deleteConfirm', { id: template.id }))) {
                        void run(() => window.fillforge.templates.delete(template.id));
                      }
                    }}
                  >
                    {t('templates.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(templates.data?.length ?? 0) === 0 && !templates.loading && (
          <p className="empty-hint">{t('templates.empty')}</p>
        )}
      </Section>
    </div>
  );
}
