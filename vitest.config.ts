import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Two environments: core/main run on Node (node:sqlite, real fs); the renderer runs in jsdom.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/**/src/**/*.test.ts', 'apps/desktop/src/{main,shared}/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // esbuild handles JSX; the React plugin only adds fast refresh, which tests never use.
        esbuild: { jsx: 'automatic' },
        resolve: { alias: { '@': resolve(__dirname, 'apps/desktop/src/renderer/src') } },
        test: {
          name: 'renderer',
          include: ['apps/desktop/src/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/desktop/src/renderer/test-setup.ts'],
        },
      },
    ],
  },
});
