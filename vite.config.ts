import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** CSP: в браузере интерфейс ходит в dev-мост по WebSocket, в APK — никуда, кроме себя. */
const csp = (mode: string): Plugin => ({
  name: 'cvg-csp',
  transformIndexHtml: (html) => html.replace('%CVG_CONNECT_SRC%', mode === 'android' ? "'self'" : "'self' ws://127.0.0.1:*"),
});

export default defineConfig(({ mode }) => ({
  root: 'src/renderer',
  base: './',
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@core': resolve(import.meta.dirname, 'src/core') } },
  plugins: [react(), csp(mode)],
}));
