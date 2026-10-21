import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@core': resolve(import.meta.dirname, 'src/core') } },
  plugins: [react()],
});
