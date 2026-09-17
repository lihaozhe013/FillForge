import type { ExtractionIssue } from '@fillforge/extraction';
import type { AttachmentMetadata, ExtractionResult, ReviewedRecord } from '@fillforge/schema';
import { useEffect, useMemo, useState } from 'react';
import type { Navigate } from '../App';
import { ErrorBanner, Section, StatusBadge } from '../components/ui';
import { copyToClipboard, extractError, useAsyncData } from '../hooks/useAsyncData';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';

function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function inputValue(value: unknown): string {
  return value === null || value === undefined ? '' : displayValue(value).replace(/^—$/, '');
}

export function RunPage({ runId, navigate }: { runId: string; navigate: Navigate }) {
  const run = useAsyncData(() => window.fillforge.runs.load(runId), [runId]);
  const template = useAsyncData(
    () =>
      run.data
        ? window.fillforge.templates.load(run.data.metadata.template_id)
        : Promise.resolve(null),
    [run.data]
  );
  const [error, setError] = useState<AppErrorDtoLike | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rawPaste, setRawPaste] = useState('');
  const [issues, setIssues] = useState<ExtractionIssue[]>([]);
  const [finalValues, setFinalValues] = useState<Record<string, unknown>>({});

  const extraction: ExtractionResult | null = run.data?.extraction ?? null;
  const review: ReviewedRecord | null = run.data?.review ?? null;

  const reviewKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of Object.keys(template.data?.fields ?? {})) keys.add(key);
    for (const key of Object.keys(extraction ?? {})) keys.add(key);
    for (const key of Object.keys(review?.fields ?? {})) keys.add(key);
    return [...keys];
  }, [extraction, review, template.data]);

  useEffect(() => {
    if (!extraction || !template.data) {
      return;
    }
    setFinalValues((current) => {
      if (Object.keys(current).length > 0) {
        return current;
      }
      const seeded: Record<string, unknown> = {};
      for (const key of reviewKeys) {
        const reviewed = review?.fields[key];
        const value = reviewed ? reviewed.final_value : extraction[key]?.value;
        seeded[key] = inputValue(value);
      }
      return seeded;
    });
  }, [extraction, review, reviewKeys, template.data]);

  async function act(action: () => Promise<unknown>, message?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (message) {
        setNotice(message);
      }
      run.reload();
      return true;
    } catch (cause) {
      setError(extractError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const metadata = run.data?.metadata;

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Run <code>{runId}</code>
        </h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'runs' })}>All runs</button>
        </div>
      </header>

      <ErrorBanner error={error ?? run.error} />
      {notice && (
        <div className="notice-banner">
          {notice}{' '}
          <button className="link" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}

      {metadata && (
        <Section title="Run">
          <div className="report">
            <div>
              Template: <code>{metadata.template_id}</code> · Created:{' '}
              {new Date(metadata.created_at).toLocaleString()} · Prompt version:{' '}
              <code>{metadata.prompt_version}</code>
            </div>
            <div>
              Directory: <code>~/.local/fillforge/runs/{metadata.id}/</code>
            </div>
          </div>
        </Section>
      )}

      <Section
        title="Source materials"
        actions={
          <button
            className="link"
            disabled={busy}
            onClick={() => void act(() => window.fillforge.runs.attachFiles(runId))}
          >
            attach files
          </button>
        }
      >
        <ul className="list">
          {(metadata?.attachments ?? []).map((attachment: AttachmentMetadata) => (
            <li key={attachment.filename}>
              {attachment.filename}{' '}
              <span className="muted">
                ({attachment.media_type}
                {attachment.original_filename !== attachment.filename
                  ? `, from ${attachment.original_filename}`
                  : ''}
                )
              </span>
            </li>
          ))}
        </ul>
        {(metadata?.attachments.length ?? 0) === 0 && (
          <p className="empty-hint">
            Optional. Attach evidence (invoice photos, PDFs) to keep it with the run.
          </p>
        )}
      </Section>

      <Section
        title="1. Extraction prompt"
        actions={
          run.data && (
            <>
              {!run.data.prompt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() => window.fillforge.runs.generatePrompt(runId), 'Prompt generated.')
                  }
                >
                  Generate prompt
                </button>
              )}
              {run.data.prompt && (
                <button
                  className="link"
                  onClick={() => void copyToClipboard(run.data?.prompt ?? '')}
                >
                  copy prompt
                </button>
              )}
            </>
          )
        }
      >
        {run.data?.prompt ? (
          <>
            <pre className="prompt-preview">{run.data.prompt}</pre>
            {run.data.expectedJson && (
              <>
                <h3>Expected JSON structure</h3>
                <pre className="prompt-preview">{run.data.expectedJson}</pre>
                <button
                  className="link"
                  onClick={() => void copyToClipboard(run.data?.expectedJson ?? '')}
                >
                  copy expected JSON
                </button>
              </>
            )}
          </>
        ) : (
          <p className="empty-hint">
            Generate the prompt, paste it together with your documents into any AI, then import the
            JSON it returns below.
          </p>
        )}
      </Section>

      <Section title="2. Paste AI result">
        {extraction ? (
          <p className="muted">
            The extraction has been imported and is immutable. Use the review table below to make
            corrections; the original model values remain in <code>extraction.json</code>.
          </p>
        ) : (
          <>
            <textarea
              rows={8}
              placeholder={`Paste the JSON returned by the AI, e.g.\n{\n  "invoice_number": {\n    "value": "12345678",\n    "status": "found",\n    "evidence": "invoice number"\n  }\n}`}
              value={rawPaste}
              onChange={(event) => setRawPaste(event.target.value)}
            />
            <div className="row-actions">
              <button
                className="primary"
                disabled={busy || rawPaste.trim() === ''}
                onClick={async () => {
                  const succeeded = await act(async () => {
                    const imported = await window.fillforge.runs.importExtraction(runId, rawPaste);
                    setIssues(imported.issues);
                  }, 'Extraction imported. Review the values below.');
                  if (succeeded) {
                    setRawPaste('');
                    setFinalValues({});
                  }
                }}
              >
                Import extraction
              </button>
            </div>
          </>
        )}
        {issues.length > 0 && (
          <div className="issue-list">
            <strong>Validation notes (review before rendering):</strong>
            <ul>
              {issues.map((issue) => (
                <li key={`${issue.field}:${issue.code}:${issue.message}`}>
                  <code>{issue.field}</code> — {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {extraction && template.data && (
        <Section title="3. Review extracted values">
          <table className="table review-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>AI value</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Final value</th>
              </tr>
            </thead>
            <tbody>
              {reviewKeys.map((key) => {
                const field = template.data?.fields[key];
                const extracted = extraction[key];
                const reviewed = review?.fields[key];
                return (
                  <tr key={key}>
                    <td>
                      <div>{field?.label ?? key}</div>
                      <code className="muted">{key}</code>
                    </td>
                    <td className="model-value">{displayValue(extracted?.value)}</td>
                    <td>
                      <StatusBadge status={extracted?.status ?? 'not_found'} />
                    </td>
                    <td className="muted evidence">{extracted?.evidence ?? '—'}</td>
                    <td>
                      <input
                        disabled={!field}
                        value={inputValue(finalValues[key])}
                        onChange={(event) =>
                          setFinalValues({ ...finalValues, [key]: event.target.value })
                        }
                      />
                      {reviewed && <div className="muted decision">{reviewed.decision}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">
            Editing a value keeps the original AI value untouched: corrections are stored in{' '}
            <code>review.json</code>, while the model output stays in <code>extraction.json</code>.
          </p>
          <div className="row-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const saved = await window.fillforge.runs.saveReview(runId, finalValues);
                  setIssues(saved.issues);
                }, 'Review saved.')
              }
            >
              Save review
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(() => window.fillforge.runs.normalize(runId), 'Normalized values written.')
              }
            >
              Normalize
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await window.fillforge.runs.normalize(runId);
                  await window.fillforge.runs.render(runId);
                }, 'Document rendered.')
              }
            >
              Normalize + Render DOCX
            </button>
          </div>
        </Section>
      )}

      <Section title="4. Output">
        {(run.data?.outputs.length ?? 0) === 0 ? (
          <p className="empty-hint">No document rendered yet.</p>
        ) : (
          <ul className="list">
            {(run.data?.outputs ?? []).map((output) => (
              <li key={output.filename} className="output-row">
                <span>
                  {output.filename}
                  {output.filename === 'result.docx' && <span className="muted"> (latest)</span>}
                </span>
                <span className="actions-cell">
                  <button
                    className="link"
                    onClick={() => void act(() => window.fillforge.system.openPath(output.path))}
                  >
                    Open
                  </button>
                  <button
                    className="link"
                    onClick={() =>
                      void act(() => window.fillforge.system.showItemInFolder(output.path))
                    }
                  >
                    Show in folder
                  </button>
                  <button
                    className="link"
                    onClick={() =>
                      void act(
                        () => window.fillforge.system.exportCopy(output.path),
                        'Copy exported.'
                      )
                    }
                  >
                    Export copy
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
