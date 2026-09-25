import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages ship TypeScript source, so they must be bundled rather than externalized.
const workspacePackages = ['@amc/core'];

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: workspacePackages } },
  },
  preload: {
    build: { externalizeDeps: { exclude: workspacePackages } },
  },
  renderer: {
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
