import { useCallback, useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { NewRunPage } from './pages/NewRunPage';
import { RunPage } from './pages/RunPage';
import { RunsPage } from './pages/RunsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { TemplatesPage } from './pages/TemplatesPage';

export type Route =
  | { page: 'home' }
  | { page: 'templates' }
  | { page: 'templateEditor'; templateId: string }
  | { page: 'newRun'; templateId?: string }
  | { page: 'run'; runId: string }
  | { page: 'runs' }
  | { page: 'settings' };

export type Navigate = (route: Route) => void;

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'home' });

  const navigate = useCallback<Navigate>((next) => setRoute(next), []);

  useEffect(() => {
    let cancelled = false;
    window.fillforge.settings
      .load()
      .then((config) => {
        if (!cancelled) {
          document.documentElement.dataset.theme = config.theme;
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
        <button type="button" className="brand" onClick={() => navigate({ page: 'home' })}>
          FillForge
        </button>
        <nav>
          <button
            className={route.page === 'home' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate({ page: 'home' })}
          >
            Home
          </button>
          <button
            className={
              route.page === 'templates' || route.page === 'templateEditor'
                ? 'nav-item active'
                : 'nav-item'
            }
            onClick={() => navigate({ page: 'templates' })}
          >
            Templates
          </button>
          <button
            className={
              route.page === 'runs' || route.page === 'run' ? 'nav-item active' : 'nav-item'
            }
            onClick={() => navigate({ page: 'runs' })}
          >
            Runs
          </button>
          <button
            className={route.page === 'settings' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate({ page: 'settings' })}
          >
            Settings
          </button>
        </nav>
        <div className="sidebar-footer">Local-first · files stay on this machine</div>
      </aside>
      <main className="content">
        {route.page === 'home' && <HomePage navigate={navigate} />}
        {route.page === 'templates' && <TemplatesPage navigate={navigate} />}
        {route.page === 'templateEditor' && (
          <TemplateEditorPage templateId={route.templateId} navigate={navigate} />
        )}
        {route.page === 'newRun' && (
          <NewRunPage initialTemplateId={route.templateId} navigate={navigate} />
        )}
        {route.page === 'run' && <RunPage runId={route.runId} navigate={navigate} />}
        {route.page === 'runs' && <RunsPage navigate={navigate} />}
        {route.page === 'settings' && <SettingsPage navigate={navigate} />}
      </main>
    </div>
  );
}
