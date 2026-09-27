import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyLanguage } from './lib/i18n';
import { installApi } from './lib/api';
import './styles/global.css';

installApi();
applyLanguage('system');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root container');
}

createRoot(container).render(<App />);
