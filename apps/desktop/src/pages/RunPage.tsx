import type { ExtractionIssue } from '@fillforge/extraction';
import type { AttachmentMetadata, ExtractionResult, ReviewedRecord } from '@fillforge/schema';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section, StatusBadge } from '../components/ui';
import { copyToClipboard, extractError, useAsyncData } from '../hooks/useAsyncData';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';
import { formatDateTime } from '../lib/i18n';

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
  const { t } = useTranslation();
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
          {t('run.title')} <code>{runId}</code>
        </h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'runs' })}>{t('run.allRuns')}</button>
        </div>
      </header>

      <ErrorBanner error={error ?? run.error} />
      {notice && (
        <div className="notice-banner">
          {notice}{' '}
          <button className="link" onClick={() => setNotice(null)}>
            {t('common.dismiss')}
          </button>
        </div>
      )}

      {metadata && (
        <Section title={t('run.title')}>
          <div className="report">
            <div>
              {t('run.templateLabel')} <code>{metadata.template_id}</code> · {t('run.createdLabel')}{' '}
              {formatDateTime(metadata.created_at)} · {t('run.promptVersionLabel')}{' '}
              <code>{metadata.prompt_version}</code>
            </div>
            <div>
              {t('run.directoryLabel')} <code>~/.local/fillforge/runs/{metadata.id}/</code>
            </div>
          </div>
        </Section>
      )}

      <Section
        title={t('run.sourceMaterials')}
        actions={
          <button
            className="link"
            disabled={busy}
            onClick={() => void act(() => window.fillforge.runs.attachFiles(runId))}
          >
            {t('run.attachFiles')}
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
                  ? t('run.attachmentFrom', { name: attachment.original_filename })
                  : ''}
                )
              </span>
            </li>
          ))}
        </ul>
        {(metadata?.attachments.length ?? 0) === 0 && (
          <p className="empty-hint">{t('run.attachmentsEmpty')}</p>
        )}
      </Section>

      <Section
        title={t('run.step1')}
        actions={
          run.data && (
            <>
              {!run.data.prompt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => window.fillforge.runs.generatePrompt(runId),
                      t('run.promptGenerated')
                    )
                  }
                >
                  {t('run.generatePrompt')}
                </button>
              )}
              {run.data.prompt && (
                <button
                  className="link"
                  onClick={() => void copyToClipboard(run.data?.prompt ?? '')}
                >
                  {t('common.copyPrompt')}
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
                <h3>{t('common.expectedJsonTitle')}</h3>
                <pre className="prompt-preview">{run.data.expectedJson}</pre>
                <button
                  className="link"
                  onClick={() => void copyToClipboard(run.data?.expectedJson ?? '')}
                >
                  {t('common.copyExpectedJson')}
                </button>
              </>
            )}
          </>
        ) : (
          <p className="empty-hint">{t('run.promptEmpty')}</p>
        )}
      </Section>

      <Section title={t('run.step2')}>
        {extraction ? (
          <p className="muted">
            {t('run.importedBefore')} <code>extraction.json</code>.
          </p>
        ) : (
          <>
            <textarea
              rows={8}
              placeholder={`${t('run.pastePlaceholder')}\n{\n  "invoice_number": {\n    "value": "12345678",\n    "status": "found",\n    "evidence": "invoice number"\n  }\n}`}
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
                  }, t('run.importedNotice'));
                  if (succeeded) {
                    setRawPaste('');
                    setFinalValues({});
                  }
                }}
              >
                {t('run.importExtraction')}
              </button>
            </div>
          </>
        )}
        {issues.length > 0 && (
          <div className="issue-list">
            <strong>{t('run.validationNotes')}</strong>
            <ul>
              {issues.map((issue) => (
                <li key={`${issue.field}:${issue.code}:${issue.message}`}>
                  <code>{issue.field}</code> —{' '}
                  {t(`errors.issues.${issue.code}`, {
                    field: issue.field,
                    defaultValue: issue.message
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {extraction && template.data && (
        <Section title={t('run.step3')}>
          <table className="table review-table">
            <thead>
              <tr>
                <th>{t('run.colField')}</th>
                <th>{t('run.colAiValue')}</th>
                <th>{t('run.colStatus')}</th>
                <th>{t('run.colEvidence')}</th>
                <th>{t('run.colFinalValue')}</th>
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
                      {reviewed && (
                        <div className="muted decision">
                          {t(`status.${reviewed.decision}`, reviewed.decision)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">
            {t('run.reviewNoteBefore')} <code>review.json</code>
            {t('run.reviewNoteMiddle')} <code>extraction.json</code>
            {t('run.reviewNoteAfter')}
          </p>
          <div className="row-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const saved = await window.fillforge.runs.saveReview(runId, finalValues);
                  setIssues(saved.issues);
                }, t('run.reviewSaved'))
              }
            >
              {t('run.saveReview')}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(() => window.fillforge.runs.normalize(runId), t('run.normalized'))
              }
            >
              {t('run.normalize')}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await window.fillforge.runs.normalize(runId);
                  await window.fillforge.runs.render(runId);
                }, t('run.rendered'))
              }
            >
              {t('run.normalizeAndRender')}
            </button>
          </div>
        </Section>
      )}

      <Section title={t('run.step4')}>
        {(run.data?.outputs.length ?? 0) === 0 ? (
          <p className="empty-hint">{t('run.empty')}</p>
        ) : (
          <ul className="list">
            {(run.data?.outputs ?? []).map((output) => (
              <li key={output.filename} className="output-row">
                <span>
                  {output.filename}
                  {output.filename === 'result.docx' && (
                    <span className="muted"> {t('run.latest')}</span>
                  )}
                </span>
                <span className="actions-cell">
                  <button
                    className="link"
                    onClick={() => void act(() => window.fillforge.system.openPath(output.path))}
                  >
                    {t('common.open')}
                  </button>
                  <button
                    className="link"
                    onClick={() =>
                      void act(() => window.fillforge.system.showItemInFolder(output.path))
                    }
                  >
                    {t('run.showInFolder')}
                  </button>
                  <button
                    className="link"
                    onClick={() =>
                      void act(
                        () => window.fillforge.system.exportCopy(output.path),
                        t('run.exported')
                      )
                    }
                  >
                    {t('run.exportCopy')}
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
