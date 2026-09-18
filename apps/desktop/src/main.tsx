import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyLanguage } from './lib/i18n';
import './styles/global.css';

applyLanguage('system');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root container');
}

createRoot(container).render(<App />);
