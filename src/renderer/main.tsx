import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import { createApi } from '@core/api';
import { selectPlatform } from '../platform/select';

// window.api появляется до загрузки компонентов: они берут его при импорте (api.ts)
async function boot(): Promise<void> {
  window.api = createApi(await selectPlatform());
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
