import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests (T1.10.1). They drive the real Electron app through Playwright's `_electron`
 * runner, so there is no browser to download and nothing is mocked: the app talks to its own
 * main process, its own SQLite index, and real folders on disk.
 *
 * Every test runs against a throwaway home (`AMC_HOME`) and a throwaway tool home
 * (`AMC_TOOL_HOME`), so a test can apply a real deploy without going near `~/.claude`.
 */
export default defineConfig({
  testDir: './e2e',
  // Electron instances are heavy and each test owns a temp folder; serial keeps that honest.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
});
