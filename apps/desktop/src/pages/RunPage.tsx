import type {
  ExtractionIssue,
  ExtractionResult,
  RunDetails,
  RunSummary,
  TemplateSchema,
  TemplateSummary
} from '../lib/generated-types';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section, StatusBadge } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';
import { formatDateTime } from '../lib/i18n';

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function runStatus(run: RunSummary): string {
  if (run.artifacts.output) return 'historyStatus.complete';
  if (run.artifacts.extraction) return 'historyStatus.review';
  if (run.artifacts.prompt) return 'historyStatus.started';
  return 'historyStatus.ready';
}

export function RunPage({
  runId: initialRunId,
  initialTemplateId,
  navigate
}: {
  runId?: string;
  initialTemplateId?: string;
  navigate: Navigate;
}) {
  const { t } = useTranslation();
  const templates = useAsyncData(() => window.fillforge.templates.list(), []);
  const connections = useAsyncData(() => window.fillforge.aiConnections.list(), []);
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
  const run = useAsyncData<RunDetails | null>(
    () => (runId ? window.fillforge.runs.load(runId) : Promise.resolve(null)),
    [runId]
  );
  const [selectedTemplate, setSelectedTemplate] = useState(initialTemplateId ?? '');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [finalValues, setFinalValues] = useState<Record<string, unknown>>({});
  const [issues, setIssues] = useState<ExtractionIssue[]>([]);
  const [error, setError] = useState<AppErrorDtoLike | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<{
    deleted: number;
    failures: Array<{ id: string; message: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialRunId) setRunId(initialRunId);
  }, [initialRunId]);

  useEffect(() => {
    if (!runId && initialTemplateId) setSelectedTemplate(initialTemplateId);
  }, [initialTemplateId, runId]);

  useEffect(() => {
    if (run.data?.extraction) {
      const review = run.data.review?.fields ?? {};
      setFinalValues((current) => {
        const next = { ...current };
        for (const [key, field] of Object.entries(run.data?.extraction ?? {})) {
          if (!(key in next)) next[key] = stringValue(review[key]?.final_value ?? field.value);
        }
        return next;
      });
    }
  }, [run.data]);

  const selectedTemplateInfo = useMemo(
    () => templates.data?.find((item) => item.id === selectedTemplate),
    [selectedTemplate, templates.data]
  );
  const templateId = run.data?.metadata.template_id;
  const template = useAsyncData<TemplateSchema | null>(
    () => (templateId ? window.fillforge.templates.load(templateId) : Promise.resolve(null)),
    [templateId]
  );
  const extraction: ExtractionResult | null = run.data?.extraction ?? null;
  const configuredConnection = Boolean(connections.data?.defaultConnectionId);
  const outputs = run.data?.outputs ?? [];
  const latestOutput = outputs.find((output) => output.filename === 'result.docx') ?? outputs.at(-1);

  async function perform(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
      run.reload();
      return true;
    } catch (cause) {
      setError(extractError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setError(null);
    try {
      setHistory(await window.fillforge.runs.list());
      setHistoryOpen(true);
      setClearResult(null);
      setConfirmClear(false);
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function startRun() {
    if (!selectedTemplate) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await window.fillforge.runs.startWithFiles({ templateId: selectedTemplate });
      if (!created) return;
      setRunId(created.id);
      setIssues([]);
      setFinalValues({});
      setRawJson('');
      setAdvancedOpen(false);
      setNotice(t('run.sourcesAdded'));
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function extractWithAi() {
    if (!runId) return;
    await perform(async () => {
      const result = await window.fillforge.runs.extractWithAi(runId);
      setIssues(result.issues);
      setFinalValues({});
    }, t('run.extracted'));
  }

  async function importJson() {
    if (!runId || !rawJson.trim()) return;
    const ok = await perform(async () => {
      const imported = await window.fillforge.runs.importExtraction(runId, rawJson);
      setIssues(imported.issues);
      setFinalValues({});
    }, t('run.importedNotice'));
    if (ok) setRawJson('');
  }

  async function createDocument() {
    if (!runId) return;
    await perform(async () => {
      const result = await window.fillforge.runs.createDocument(runId, finalValues);
      setIssues(result.issues);
      if (result.output) setNotice(t('run.rendered'));
    });
  }

  async function deleteRun(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await window.fillforge.runs.delete(id);
      setHistory((current) => current.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
      setNotice(t('history.deleted', { count: result.preservedDocumentCount }));
      if (id === runId) resetRun();
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.fillforge.runs.clearAll();
      setHistory([]);
      setClearResult({ deleted: result.deletedCount, failures: result.failures });
      setHistory(await window.fillforge.runs.list());
      setConfirmClear(false);
      setNotice(
        result.failures.length > 0
          ? t('history.clearPartial', { deleted: result.deletedCount, failed: result.failures.length })
          : t('history.cleared', { count: result.preservedDocumentCount })
      );
      resetRun();
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openSavedDocuments() {
    await perform(() => window.fillforge.system.openSavedDocuments());
  }

  function resetRun() {
    setRunId(null);
    setSelectedTemplate('');
    setFinalValues({});
    setIssues([]);
    setRawJson('');
    setAdvancedOpen(false);
    setNotice(null);
    navigate({ page: 'run' });
  }

  const fieldEntries = Object.entries(extraction ?? {});
  const templateFields = template.data?.fields ?? {};

  return (
    <div className="page run-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('run.eyebrow')}</p>
          <h1>{run.data ? run.data.outputs.length ? t('run.completeTitle') : t('run.title') : t('run.title')}</h1>
        </div>
        <div className="page-actions">
          <button disabled={historyLoading} onClick={() => void loadHistory()}>
            {historyLoading ? t('history.loading') : t('history.open')}
          </button>
        </div>
      </header>

      <ErrorBanner error={error ?? run.error ?? templates.error ?? connections.error} />
      {notice && <div className="notice-banner">{notice}</div>}

      {!runId ? (
        <>
          <div className="run-welcome">
            <div className="run-welcome-copy">
              <h2>{t('run.welcomeTitle')}</h2>
              <p>{t('run.welcomeDescription')}</p>
            </div>
            <div className="run-step-indicator">
              <span className="step-number">1</span>
              <span>{t('run.selectTemplate')}</span>
              <span className="step-line" />
              <span className="step-number">2</span>
              <span>{t('run.addSources')}</span>
            </div>
          </div>

          <Section title={t('run.chooseTemplate')}>
            {templates.loading ? <p className="empty-hint">{t('common.loading')}</p> : null}
            <div className="template-choice-grid">
              {(templates.data ?? [])
                .filter((item: TemplateSummary) => item.hasDocument)
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`template-choice${selectedTemplate === item.id ? ' selected' : ''}`}
                    onClick={() => setSelectedTemplate(item.id)}
                  >
                    <span className="template-choice-icon" aria-hidden="true">▤</span>
                    <span className="template-choice-name">{item.name}</span>
                    <span className="template-choice-description">
                      {item.description || t('run.templateReady')}
                    </span>
                    {selectedTemplate === item.id && <span className="selected-indicator">✓</span>}
                  </button>
                ))}
            </div>
            {(templates.data ?? []).filter((item) => item.hasDocument).length === 0 && !templates.loading && (
              <div className="setup-card">
                <div>
                  <strong>{t('run.noTemplatesTitle')}</strong>
                  <p>{t('run.noTemplatesDescription')}</p>
                </div>
                <button className="primary" onClick={() => navigate({ page: 'templates' })}>
                  {t('run.manageTemplates')}
                </button>
              </div>
            )}
            {selectedTemplateInfo && (
              <div className="selected-template-bar">
                <span>{t('run.selectedTemplate', { name: selectedTemplateInfo.name })}</span>
                <button className="primary" disabled={busy} onClick={() => void startRun()}>
                  {busy ? t('run.openingFiles') : t('run.chooseFiles')}
                </button>
              </div>
            )}
          </Section>

          <div className="run-hint-row">
            <span className="hint-icon" aria-hidden="true">i</span>
            <span>{t('run.localHint')}</span>
            <span className="muted">{t('run.supportedFiles')}</span>
          </div>
        </>
      ) : (
        <>
          <div className="run-context-bar">
            <div>
              <span className="muted">{t('run.workingOn')}</span>
              <strong>{template.data?.name ?? selectedTemplateInfo?.name ?? run.data?.metadata.template_id}</strong>
            </div>
            <button className="link" disabled={busy} onClick={() => resetRun()}>
              {t('run.startAnother')}
            </button>
          </div>

          <section className="workflow-progress" aria-label={t('run.workflowProgress')}>
            <div className={run.data?.metadata.attachments.length ? 'progress-step done' : 'progress-step active'}>
              <span>1</span><small>{t('run.progressSources')}</small>
            </div>
            <span className="progress-line" />
            <div className={extraction ? 'progress-step done' : run.data?.metadata.attachments.length ? 'progress-step active' : 'progress-step'}>
              <span>2</span><small>{t('run.progressExtract')}</small>
            </div>
            <span className="progress-line" />
            <div className={outputs.length ? 'progress-step done' : extraction ? 'progress-step active' : 'progress-step'}>
              <span>3</span><small>{t('run.progressCreate')}</small>
            </div>
          </section>

          <Section title={t('run.sourceMaterials')}>
            <div className="source-file-list">
              {run.data?.metadata.attachments.map((attachment) => (
                <div className="source-file" key={attachment.filename}>
                  <span className="file-icon" aria-hidden="true">▧</span>
                  <span className="source-file-name">{attachment.original_filename}</span>
                  <span className="muted">{attachment.media_type}</span>
                </div>
              ))}
            </div>
            <div className="source-footer">
              <span className="muted">{t('run.sourcesAttached', { count: run.data?.metadata.attachments.length ?? 0 })}</span>
              {run.data?.metadata.attachments.length ? (
                <span className="muted">{t('run.sourceSecureHint')}</span>
              ) : null}
            </div>
          </Section>

          {!extraction && (
            <Section title={t('run.aiStepTitle')}>
              {configuredConnection ? (
                <div className="ai-action-card">
                  <div className="ai-action-icon" aria-hidden="true">✦</div>
                  <div className="ai-action-copy">
                    <strong>{t('run.aiReadyTitle')}</strong>
                    <p>{t('run.aiReadyDescription')}</p>
                    <small>{t('run.aiTransmissionNote')}</small>
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !(run.data?.metadata.attachments.length)}
                    onClick={() => void extractWithAi()}
                  >
                    {busy ? t('run.extracting') : t('run.extractWithAi')}
                  </button>
                </div>
              ) : (
                <div className="setup-card">
                  <div>
                    <strong>{t('run.aiNotConfiguredTitle')}</strong>
                    <p>{t('run.aiNotConfiguredDescription')}</p>
                  </div>
                  <button className="primary" onClick={() => navigate({ page: 'settings', category: 'aiConnections' })}>
                    {t('run.setUpAi')}
                  </button>
                </div>
              )}
              {!run.data?.metadata.attachments.length && (
                <p className="empty-hint">{t('run.addSourceFirst')}</p>
              )}
            </Section>
          )}

          {extraction && (
            <Section
              title={t('run.reviewTitle')}
              actions={<span className="muted">{t('run.reviewSubtitle')}</span>}
            >
              <div className="review-field-list">
                {fieldEntries.map(([key, extracted]) => {
                  const field = templateFields[key];
                  const currentValue = finalValues[key] ?? '';
                  const fieldIssues = issues.filter((issue) => issue.field === key);
                  return (
                    <div className="review-field" key={key}>
                      <label className="review-field-label" htmlFor={`review-${key}`}>
                        <span>{field?.label ?? key}{field?.required && <span className="required-mark"> *</span>}</span>
                        <small>{field?.description}</small>
                      </label>
                      <input
                        id={`review-${key}`}
                        className={fieldIssues.length ? 'invalid' : ''}
                        value={String(currentValue)}
                        onChange={(event) => setFinalValues({ ...finalValues, [key]: event.target.value })}
                        placeholder={t('run.valuePlaceholder')}
                      />
                      {fieldIssues.length > 0 && (
                        <span className="field-validation">{fieldIssues.map((issue) => issue.message).join(' ')}</span>
                      )}
                      <details className="field-evidence">
                        <summary><StatusBadge status={extracted.status} />{t('run.viewEvidence')}</summary>
                        <div className="evidence-details">
                          <span>{t('run.aiValue')}: <strong>{stringValue(extracted.value) || t('run.noValue')}</strong></span>
                          <span>{t('run.evidence')}: {extracted.evidence || t('run.noEvidence')}</span>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
              {issues.some((issue) => !fieldEntries.some(([key]) => key === issue.field)) && (
                <div className="issue-list">
                  {issues.filter((issue) => !fieldEntries.some(([key]) => key === issue.field)).map((issue) => (
                    <div key={`${issue.field}:${issue.code}`}>{issue.message}</div>
                  ))}
                </div>
              )}
              <div className="create-document-footer">
                <span className="muted">{t('run.createDocumentHint')}</span>
                <button className="primary" disabled={busy} onClick={() => void createDocument()}>
                  {busy ? t('run.creatingDocument') : t('run.createDocument')}
                </button>
              </div>
            </Section>
          )}

          {latestOutput && (
            <div className="complete-card">
              <div className="complete-icon" aria-hidden="true">✓</div>
              <div className="complete-copy">
                <h2>{t('run.documentReady')}</h2>
                <p>{latestOutput.filename}</p>
              </div>
              <div className="complete-actions">
                <button className="primary" onClick={() => void perform(() => window.fillforge.system.openPath(latestOutput.path))}>
                  {t('run.openDocument')}
                </button>
                <button onClick={() => void perform(() => window.fillforge.system.exportCopy(latestOutput.path), t('run.savedCopy'))}>
                  {t('run.saveCopy')}
                </button>
                <button className="link" onClick={resetRun}>{t('run.startAnother')}</button>
              </div>
            </div>
          )}

          <details className="advanced-run card" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>
              <span>{t('run.advancedTitle')}</span>
              <span className="muted">{advancedOpen ? t('run.hideAdvanced') : t('run.showAdvanced')}</span>
            </summary>
            {advancedOpen && (
              <div className="advanced-run-content">
                <div>
                  <h3>{t('run.promptTools')}</h3>
                  <p className="muted">{t('run.promptToolsDescription')}</p>
                  <button disabled={busy} onClick={() => void perform(() => window.fillforge.runs.generatePrompt(runId), t('run.promptGenerated'))}>
                    {t('run.generatePrompt')}
                  </button>
                  {run.data?.prompt && <pre className="prompt-preview">{run.data.prompt}</pre>}
                  {run.data?.expectedJson && <pre className="prompt-preview">{run.data.expectedJson}</pre>}
                </div>
                <div>
                  <h3>{t('run.importJson')}</h3>
                  <textarea rows={7} value={rawJson} onChange={(event) => setRawJson(event.target.value)} placeholder={t('run.pastePlaceholder')} />
                  <button className="primary" disabled={busy || !rawJson.trim()} onClick={() => void importJson()}>
                    {t('run.importExtraction')}
                  </button>
                </div>
              </div>
            )}
          </details>
        </>
      )}

      {historyOpen && (
        <div className="history-backdrop" role="presentation">
          <button className="history-backdrop-button" aria-label={t('common.close')} onClick={() => setHistoryOpen(false)} />
          <aside className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <header className="history-header">
              <div><h2 id="history-title">{t('history.title')}</h2><p>{t('history.description')}</p></div>
              <button className="icon-button" aria-label={t('common.close')} onClick={() => setHistoryOpen(false)}>×</button>
            </header>
            <div className="history-toolbar">
              <span>{t('history.runCount', { count: history.length })}</span>
              {history.length > 0 && <button className="link danger" disabled={busy} onClick={() => setConfirmClear(!confirmClear)}>{t('history.clearAll')}</button>}
            </div>
            {confirmClear && (
              <div className="inline-confirm">
                <div><strong>{t('history.confirmClearTitle')}</strong><p>{t('history.confirmClearDescription')}</p></div>
                <div><button disabled={busy} onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button><button className="danger-button" disabled={busy} onClick={() => void clearHistory()}>{t('history.clearAll')}</button></div>
              </div>
            )}
            {history.length === 0 ? <p className="empty-hint">{t('history.empty')}</p> : (
              <div className="history-list">
                {history.map((item) => {
                  const templateName = templates.data?.find((candidate) => candidate.id === item.templateId)?.name ?? item.templateId;
                  return (
                    <article className="history-item" key={item.id}>
                      <div className="history-item-main">
                        <strong>{templateName}</strong>
                        <span>{formatDateTime(item.createdAt)}</span>
                        <span className="history-status">{t(runStatus(item))}</span>
                      </div>
                      {confirmDeleteId === item.id ? (
                        <div className="inline-confirm compact">
                          <span>{t('history.confirmDelete')}</span>
                          <button className="link" onClick={() => setConfirmDeleteId(null)}>{t('common.cancel')}</button>
                          <button className="link danger" disabled={busy} onClick={() => void deleteRun(item.id)}>{t('history.delete')}</button>
                        </div>
                      ) : (
                        <div className="history-item-actions">
                          <button className="link" onClick={() => { setHistoryOpen(false); navigate({ page: 'run', runId: item.id }); }}>{t('history.openRun')}</button>
                          <button className="link danger" disabled={busy} onClick={() => setConfirmDeleteId(item.id)}>{t('history.delete')}</button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {clearResult && clearResult.failures.length > 0 && (
              <div className="history-result">
                <p>{t('history.failuresRemain', { count: clearResult.failures.length })}</p>
                <ul>
                  {clearResult.failures.map((failure) => (
                    <li key={failure.id}>{failure.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {clearResult && (clearResult.deleted > 0 || clearResult.failures.length > 0) && (
              <button className="history-saved-documents" onClick={() => void openSavedDocuments()}>{t('history.openSavedDocuments')}</button>
            )}
            <footer className="history-footer">{t('history.preserveNote')}</footer>
          </aside>
        </div>
      )}
    </div>
  );
}
