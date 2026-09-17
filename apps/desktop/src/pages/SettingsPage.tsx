import type { ResolvedAppConfig } from '@fillforge/schema';
import { useEffect, useState } from 'react';
import type { Navigate } from '../App';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';

export function SettingsPage({ navigate }: { navigate: Navigate }) {
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
        <p className="empty-hint">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: 'home' })}>Home</button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </header>

      <ErrorBanner error={error} />
      <Section title="Application">
        <div className="form-grid">
          <label>
            Theme
            <select
              value={draft.theme}
              onChange={(event) => {
                setSaved(false);
                setDraft({ ...draft, theme: event.target.value as ResolvedAppConfig['theme'] });
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Prompt version
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
            Show advanced field settings
          </label>
        </div>
        <p className="muted">
          Settings are stored in <code>~/.config/fillforge/config.yaml</code>. New runs use the
          selected prompt version.
        </p>
      </Section>
    </div>
  );
}
