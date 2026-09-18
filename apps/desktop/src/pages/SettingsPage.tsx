import type { ResolvedAppConfig } from '@fillforge/schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';
import { applyLanguage } from '../lib/i18n';

export function SettingsPage({ navigate }: { navigate: Navigate }) {
  const { t } = useTranslation();
  const loaded = useAsyncData(() => window.fillforge.settings.load(), []);
  const [draft, setDraft] = useState<ResolvedAppConfig | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) {
      setDraft(loaded.data);
    }
  }, [loaded.data]);

  useEffect(() => {
    if (draft) {
      document.documentElement.dataset.theme = draft.theme;
      applyLanguage(draft.language);
    }
  }, [draft]);

  async function save() {
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

  if (!draft) {
    return (
      <div className="page">
        <ErrorBanner error={error ?? loaded.error} />
        <p className="empty-hint">{t('settings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'home' })}>{t('nav.home')}</button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {saved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </header>

      <ErrorBanner error={error} />
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
            {t('settings.theme')}
            <select
              value={draft.theme}
              onChange={(event) => {
                setSaved(false);
                setDraft({ ...draft, theme: event.target.value as ResolvedAppConfig['theme'] });
              }}
            >
              <option value="system">{t('settings.themeSystem')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
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
        <p className="muted">
          {t('settings.storedBefore')} <code>~/.config/fillforge/config.yaml</code>
          {t('settings.storedAfter')}
        </p>
      </Section>
    </div>
  );
}
