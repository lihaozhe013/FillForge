import type { AiReasoningEffort, ResolvedAppConfig } from '../lib/generated-types';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate, Route } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';
import { applyLanguage } from '../lib/i18n';
import { AiConnectionsSettings } from './AiConnectionsSettings';

type SettingsCategory = Extract<Route, { page: 'settings' }>['category'];

export function SettingsPage({
  category = 'general',
  navigate
}: {
  category?: SettingsCategory;
  navigate: Navigate;
}) {
  const { t } = useTranslation();
  const loaded = useAsyncData(() => window.fillforge.settings.load(), []);
  const [draft, setDraft] = useState<ResolvedAppConfig | null>(null);
  const [error, setError] = useState<AppErrorDtoLike | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) setDraft(loaded.data);
  }, [loaded.data]);

  useEffect(() => {
    if (draft) {
      document.documentElement.dataset.theme = draft.theme;
      applyLanguage(draft.language);
    }
  }, [draft]);

  async function saveSettings() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      setDraft(await window.fillforge.settings.save(draft));
      setSaved(true);
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  function selectCategory(next: NonNullable<SettingsCategory>) {
    navigate({ page: 'settings', category: next });
  }

  if (!draft) {
    return (
      <div className="page">
        <ErrorBanner error={error ?? loaded.error} />
        <p className="empty-hint">{t('settings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('settings.eyebrow')}</p>
          <h1>{t('settings.title')}</h1>
        </div>
        {category !== 'data' && (
          <button className="primary" disabled={busy} onClick={() => void saveSettings()}>
            {category === 'aiConnections'
              ? saved
                ? t('common.saved')
                : t('settings.savePreferences')
              : saved
                ? t('common.saved')
                : t('common.save')}
          </button>
        )}
      </header>
      <ErrorBanner error={error} />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.categories')}>
          <span className="settings-nav-label">{t('settings.categories')}</span>
          <button
            className={category === 'general' ? 'selected' : ''}
            onClick={() => selectCategory('general')}
          >
            ◉ <span>{t('settings.general')}</span>
          </button>
          <button
            className={category === 'appearance' ? 'selected' : ''}
            onClick={() => selectCategory('appearance')}
          >
            ◐ <span>{t('settings.appearance')}</span>
          </button>
          <button
            className={category === 'aiConnections' ? 'selected' : ''}
            onClick={() => selectCategory('aiConnections')}
          >
            ✦ <span>{t('settings.aiConnections')}</span>
          </button>
          <button
            className={category === 'data' ? 'selected' : ''}
            onClick={() => selectCategory('data')}
          >
            ▤ <span>{t('settings.dataStorage')}</span>
          </button>
        </nav>

        <div className="settings-content">
          {category === 'general' && (
            <>
              <div className="settings-section-heading">
                <h2>{t('settings.general')}</h2>
                <p>{t('settings.generalDescription')}</p>
              </div>
              <Section title={t('settings.application')}>
                <div className="form-grid">
                  <label>
                    {t('settings.language')}
                    <select
                      value={draft.language}
                      onChange={(event) => {
                        setSaved(false);
                        setDraft({
                          ...draft,
                          language: event.target.value as ResolvedAppConfig['language']
                        });
                      }}
                    >
                      <option value="system">{t('settings.languageSystem')}</option>
                      <option value="en">{t('settings.languageEn')}</option>
                      <option value="zh-CN">{t('settings.languageZh')}</option>
                    </select>
                  </label>
                  <label>
                    {t('settings.promptVersion')}
                    <input
                      value={draft.promptVersion}
                      onChange={(event) => {
                        setSaved(false);
                        setDraft({ ...draft, promptVersion: event.target.value });
                      }}
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={draft.showAdvancedFields}
                      onChange={(event) => {
                        setSaved(false);
                        setDraft({ ...draft, showAdvancedFields: event.target.checked });
                      }}
                    />
                    {t('settings.showAdvanced')}
                  </label>
                </div>
              </Section>
            </>
          )}

          {category === 'appearance' && (
            <>
              <div className="settings-section-heading">
                <h2>{t('settings.appearance')}</h2>
                <p>{t('settings.appearanceDescription')}</p>
              </div>
              <Section title={t('settings.theme')}>
                <div className="theme-choice-row">
                  {(['light', 'dark', 'system'] as const).map((theme) => (
                    <button
                      key={theme}
                      className={`theme-choice${draft.theme === theme ? ' selected' : ''}`}
                      onClick={() => {
                        setSaved(false);
                        setDraft({ ...draft, theme });
                      }}
                    >
                      <span className={`theme-preview theme-preview-${theme}`} aria-hidden="true" />
                      <strong>
                        {t(`settings.theme${theme.charAt(0).toUpperCase()}${theme.slice(1)}`)}
                      </strong>
                      {draft.theme === theme && <span className="selected-indicator">✓</span>}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {category === 'aiConnections' && (
            <AiConnectionsSettings
              reasoningEffort={draft.reasoningEffort}
              onReasoningEffortChange={(reasoningEffort: AiReasoningEffort) => {
                setSaved(false);
                setDraft({ ...draft, reasoningEffort });
              }}
            />
          )}

          {category === 'data' && (
            <>
              <div className="settings-section-heading">
                <h2>{t('settings.dataStorage')}</h2>
                <p>{t('settings.dataDescription')}</p>
              </div>
              <Section title={t('settings.localData')}>
                <p>{t('settings.localDataDescription')}</p>
                <p className="muted">{t('settings.historyCleanupHint')}</p>
                <button onClick={() => navigate({ page: 'run' })}>{t('history.open')}</button>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
