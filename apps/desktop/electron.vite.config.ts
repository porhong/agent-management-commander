import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages ship TypeScript source, so they must be bundled rather than externalized.
const workspacePackages = ['@amc/core', '@amc/adapter-claude-code', '@amc/adapter-codex-cli'];
// The packaged app ships `out/**` and nothing else, so anything main needs at runtime has to be
// bundled in rather than externalized.
const bundledIntoMain = [...workspacePackages, 'electron-updater'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundledIntoMain },
      rollupOptions: {
        // The utility process (T1.5.5) is a second entry, loaded as out/main/worker.js.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/main/worker/entry.ts'),
        },
      },
    },
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
