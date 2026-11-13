import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { loadEnv } from 'vite';
import { bugReportOrigin } from './scripts/bug-report-origin';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/** CSP: в браузере интерфейс ходит в dev-мост по WebSocket, в APK — только к себе; обоим — в GitHub за последним релизом. */
const csp = (mode: string, origin: string): Plugin => ({
  name: 'cvg-csp',
  transformIndexHtml: (html) =>
    html.replace('%CVG_CONNECT_SRC%', `${mode === 'android' ? "'self'" : "'self' ws://127.0.0.1:*"} https://api.github.com ${origin}`),
});

export default defineConfig(({ mode }) => {
  const origin = bugReportOrigin(loadEnv(mode, process.cwd()).VITE_BUG_REPORT_ORIGIN);
  return {
    root: 'src/renderer',
    base: './',
    build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
    resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@core': resolve(import.meta.dirname, 'src/core') } },
    plugins: [react(), csp(mode, origin)],
    // Версия приложения — для сравнения с последним релизом на GitHub
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUG_REPORT_ORIGIN__: JSON.stringify(origin) },
  };
});
