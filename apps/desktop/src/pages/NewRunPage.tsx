import type { TemplateSummary } from '@fillforge/schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';

export function NewRunPage({
  initialTemplateId,
  navigate
}: {
  initialTemplateId?: string;
  navigate: Navigate;
}) {
  const { t } = useTranslation();
  const templates = useAsyncData(() => window.fillforge.templates.list(), []);
  const [selected, setSelected] = useState(initialTemplateId ?? '');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function createRun() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const run = await window.fillforge.runs.create({
        templateId: selected
      });
      navigate({ page: 'run', runId: run.id });
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  const templatesWithoutDocument = (templates.data ?? []).filter(
    (template: TemplateSummary) => template.hasDocument
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('newRun.title')}</h1>
      </header>

      <ErrorBanner error={error ?? templates.error} />

      <Section title={t('newRun.step1')}>
        {templates.loading && <p className="empty-hint">{t('common.loading')}</p>}
        <ul className="list">
          {templatesWithoutDocument.map((template) => (
            <li key={template.id}>
              <label className="radio-row">
                <input
                  type="radio"
                  name="template"
                  value={template.id}
                  checked={selected === template.id}
                  onChange={() => setSelected(template.id)}
                />
                <span>
                  {template.name} <span className="muted">({template.id})</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {templatesWithoutDocument.length === 0 && !templates.loading && (
          <p className="empty-hint">{t('newRun.empty')}</p>
        )}
      </Section>

      <Section title={t('newRun.step2')}>
        <p className="muted">
          {t('newRun.descriptionBefore')} <code>~/.local/fillforge/runs/&lt;id&gt;/</code>
          {t('newRun.descriptionAfter')}
        </p>
        <button className="primary" disabled={!selected || busy} onClick={() => void createRun()}>
          {busy ? t('newRun.creating') : t('newRun.create')}
        </button>
      </Section>
    </div>
  );
}
