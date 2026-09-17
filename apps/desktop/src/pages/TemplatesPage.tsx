import type { TemplateSummary } from '@fillforge/schema';
import { useState } from 'react';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';

export function TemplatesPage({ navigate }: { navigate: Navigate }) {
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
        <h1>Templates</h1>
        <div className="page-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => window.fillforge.templates.import())}
          >
            Import DOCX
          </button>
          <button onClick={() => navigate({ page: 'newRun' })}>New run</button>
        </div>
      </header>

      <ErrorBanner error={error ?? templates.error} />

      <Section title={`Available templates (${templates.data?.length ?? 0})`}>
        {templates.loading && <p className="empty-hint">Loading…</p>}
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Id</th>
              <th>Description</th>
              <th>Document</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(templates.data ?? []).map((template: TemplateSummary) => (
              <tr key={template.id}>
                <td>{template.name}</td>
                <td className="muted">{template.id}</td>
                <td className="muted">{template.description ?? '—'}</td>
                <td>{template.hasDocument ? '✓' : 'missing'}</td>
                <td className="actions-cell">
                  <button
                    className="link"
                    onClick={() => navigate({ page: 'templateEditor', templateId: template.id })}
                  >
                    Open
                  </button>
                  <button
                    className="link"
                    onClick={() => navigate({ page: 'newRun', templateId: template.id })}
                  >
                    New run
                  </button>
                  <button
                    className="link"
                    disabled={busy}
                    onClick={() =>
                      void run(() => window.fillforge.templates.duplicate(template.id))
                    }
                  >
                    Duplicate
                  </button>
                  <button
                    className="link danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete template "${template.id}"? This removes its directory.`
                        )
                      ) {
                        void run(() => window.fillforge.templates.delete(template.id));
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(templates.data?.length ?? 0) === 0 && !templates.loading && (
          <p className="empty-hint">Import a DOCX file to create a template.</p>
        )}
      </Section>
    </div>
  );
}
