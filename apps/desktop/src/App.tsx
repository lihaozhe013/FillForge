import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HomePage } from './pages/HomePage';
import { RunPage } from './pages/RunPage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { applyLanguage } from './lib/i18n';

export type Route =
  | { page: 'home' }
  | { page: 'templates' }
  | { page: 'templateEditor'; templateId: string }
  | { page: 'run'; runId?: string; templateId?: string }
  | { page: 'settings'; category?: 'general' | 'appearance' | 'aiConnections' | 'data' };

export type Navigate = (route: Route) => void;

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'run' });
  const { t } = useTranslation();

  const navigate = useCallback<Navigate>((next) => setRoute(next), []);

  useEffect(() => {
    let cancelled = false;
    window.fillforge.settings
      .load()
      .then((config) => {
        if (!cancelled) {
          document.documentElement.dataset.theme = config.theme;
          applyLanguage(config.language);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => navigate({ page: 'run' })}>
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <span className="brand-name">FillForge</span>
        </button>
        <nav>
          <button
            className={route.page === 'run' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate({ page: 'run' })}
          >
            {t('nav.run')}
          </button>
          <button
            className={
              route.page === 'templates' || route.page === 'templateEditor'
                ? 'nav-item active'
                : 'nav-item'
            }
            onClick={() => navigate({ page: 'templates' })}
          >
            {t('nav.templates')}
          </button>
          <button
            className={route.page === 'settings' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate({ page: 'settings' })}
          >
            {t('nav.settings')}
          </button>
        </nav>
        <div className="sidebar-footer">{t('common.tagline')}</div>
      </aside>
      <main className="content">
        {route.page === 'home' && <HomePage navigate={navigate} />}
        {route.page === 'templates' && <TemplatesPage navigate={navigate} />}
        {route.page === 'templateEditor' && (
          <TemplateEditorPage templateId={route.templateId} navigate={navigate} />
        )}
        {route.page === 'run' && (
          <RunPage runId={route.runId} initialTemplateId={route.templateId} navigate={navigate} />
        )}
        {route.page === 'settings' && <SettingsPage category={route.category} navigate={navigate} />}
      </main>
    </div>
  );
}
