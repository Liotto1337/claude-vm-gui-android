import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/** CSP: в браузере интерфейс ходит в dev-мост по WebSocket, в APK — только к себе; обоим — в GitHub за последним релизом. */
const csp = (mode: string): Plugin => ({
  name: 'cvg-csp',
  transformIndexHtml: (html) =>
    html.replace('%CVG_CONNECT_SRC%', `${mode === 'android' ? "'self'" : "'self' ws://127.0.0.1:*"} https://api.github.com`),
});

export default defineConfig(({ mode }) => ({
  root: 'src/renderer',
  base: './',
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@core': resolve(import.meta.dirname, 'src/core') } },
  plugins: [react(), csp(mode)],
  // Версия приложения — для сравнения с последним релизом на GitHub
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
}));
