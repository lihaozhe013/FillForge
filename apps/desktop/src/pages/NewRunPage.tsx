import type { TemplateSummary } from '@fillforge/schema';
import { useState } from 'react';
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
        <h1>New run</h1>
      </header>

      <ErrorBanner error={error ?? templates.error} />

      <Section title="1. Select a template">
        {templates.loading && <p className="empty-hint">Loading…</p>}
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
          <p className="empty-hint">Import a template first.</p>
        )}
      </Section>

      <Section title="2. Create the run">
        <p className="muted">
          A run is a self-contained directory under <code>~/.local/fillforge/runs/&lt;id&gt;/</code>
          . You can attach source images or PDFs to it afterwards; they are copied into the run and
          never modified.
        </p>
        <button className="primary" disabled={!selected || busy} onClick={() => void createRun()}>
          {busy ? 'Creating…' : 'Create run'}
        </button>
      </Section>
    </div>
  );
}
