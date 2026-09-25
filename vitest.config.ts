import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/desktop/src/{main,shared}/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
