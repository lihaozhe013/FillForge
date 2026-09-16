import type { RunSummary, TemplateSummary } from "@docufill/schema";
import { useState } from "react";
import type { Navigate } from "../App";
import { ErrorBanner, Section } from "../components/ui";
import { extractError, useAsyncData } from "../hooks/useAsyncData";

export function HomePage({ navigate }: { navigate: Navigate }) {
  const templates = useAsyncData(() => window.docufill.templates.list(), []);
  const runs = useAsyncData(() => window.docufill.runs.list(), []);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);

  const error = actionError ?? templates.error ?? runs.error;
  const recentRuns: RunSummary[] = (runs.data ?? []).slice(0, 5);

  async function importTemplate() {
    try {
      setActionError(null);
      await window.docufill.templates.import();
      templates.reload();
    } catch (cause) {
      setActionError(extractError(cause));
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Home</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: "templates" })}>Templates</button>
          <button className="primary" onClick={() => void importTemplate()}>
            Import template
          </button>
        </div>
      </header>

      <ErrorBanner error={error} />

      <div className="grid-2">
        <Section title={`Templates (${templates.data?.length ?? 0})`}>
          {templates.loading && <p className="empty-hint">Loading…</p>}
          <ul className="list">
            {(templates.data ?? []).map((template: TemplateSummary) => (
              <li key={template.id}>
                <button
                  className="link"
                  onClick={() =>
                    navigate({
                      page: "templateEditor",
                      templateId: template.id,
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
            <p className="empty-hint">No templates yet. Import a DOCX file to get started.</p>
          )}
        </Section>

        <Section
          title="Recent runs"
          actions={
            <button className="link" onClick={() => navigate({ page: "runs" })}>
              view all
            </button>
          }
        >
          {runs.loading && <p className="empty-hint">Loading…</p>}
          <ul className="list">
            {recentRuns.map((run) => (
              <li key={run.id}>
                <button className="link" onClick={() => navigate({ page: "run", runId: run.id })}>
                  {run.id}
                </button>
                <span className="muted">
                  {" "}
                  · {run.templateId} · {new Date(run.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          {recentRuns.length === 0 && !runs.loading && <p className="empty-hint">No runs yet.</p>}
        </Section>
      </div>

      <Section title="Workflow">
        <ol className="workflow">
          <li>Import a DOCX template and configure field meanings.</li>
          <li>Create a run; copy the generated extraction prompt.</li>
          <li>Give the prompt and your documents to any AI you trust.</li>
          <li>Paste the AI's JSON back, review and correct values.</li>
          <li>Render the final DOCX deterministically.</li>
        </ol>
      </Section>
    </div>
  );
}
