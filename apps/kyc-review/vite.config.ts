import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('.'),
  plugins: [react()],
  resolve: {
    alias: { '@rangka/sdk': here('../../packages/sdk/src/index.ts') },
  },
  server: {
    port: 5174,
    host: true,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
