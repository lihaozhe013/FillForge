import type { TemplateSummary } from '../lib/generated-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';

export function HomePage({ navigate }: { navigate: Navigate }) {
  const { t } = useTranslation();
  const templates = useAsyncData(() => window.fillforge.templates.list(), []);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);

  const error = actionError ?? templates.error;

  async function importTemplate() {
    try {
      setActionError(null);
      const template = await window.fillforge.templates.import();
      if (template) {
        navigate({ page: 'templateEditor', templateId: template.id });
      } else {
        templates.reload();
      }
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
