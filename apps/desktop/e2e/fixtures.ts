import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronPath from 'electron';

const APP = resolve(__dirname, '..');
const FIXTURES = resolve(__dirname, '../../../fixtures');

export interface AmcApp {
  /** The app's main window. */
  page: Page;
  app: ElectronApplication;
  /** Stands in for the user's home: `<toolHome>/.claude`, `.codex`, `.agents`. */
  toolHome: string;
  /** Stands in for `~/.amc`. */
  amcHome: string;
  /** Every file under the tool folders, as `path → sha256`. */
  toolFiles(): Record<string, string>;
  read(relPath: string): string;
  exists(relPath: string): boolean;
}

/** Copies the committed tool fixtures in, so a test can import something real. */
export function seedTools(toolHome: string): void {
  cpSync(join(FIXTURES, 'claude-code', 'global'), join(toolHome, '.claude'), { recursive: true });
  cpSync(join(FIXTURES, 'codex-cli', 'codex-home'), join(toolHome, '.codex'), { recursive: true });
  cpSync(join(FIXTURES, 'codex-cli', 'agents-home'), join(toolHome, '.agents'), {
    recursive: true,
  });
}

function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        out[relative(dir, path).replace(/\\/g, '/')] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex');
      }
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir);
  return out;
}

/**
 * Launches the built app against fresh temp folders. `seed` decides whether the tool folders
 * start with the fixtures in them or empty.
 */
export const test = base.extend<{ amc: AmcApp; seed: boolean }>({
  seed: [false, { option: true }],

  amc: async ({ seed }, use) => {
    const root = mkdtempSync(join(tmpdir(), 'amc-e2e-'));
    const toolHome = join(root, 'home');
    const amcHome = join(toolHome, '.amc');
    if (seed) seedTools(toolHome);

    // Deleted, not emptied: Electron checks whether the variable *exists*, so setting it to an
    // empty string still starts it as plain Node and no window ever appears.
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    delete env['ELECTRON_RUN_AS_NODE'];

    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [APP],
      env: { ...env, AMC_HOME: amcHome, AMC_TOOL_HOME: toolHome },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await use({
      page,
      app,
      toolHome,
      amcHome,
      toolFiles: () => ({
        ...fingerprint(join(toolHome, '.claude')),
        ...fingerprint(join(toolHome, '.codex')),
        ...fingerprint(join(toolHome, '.agents')),
      }),
      read: (relPath) => readFileSync(join(toolHome, relPath), 'utf8'),
      exists: (relPath) =>
        statSync(join(toolHome, relPath), { throwIfNoEntry: false }) !== undefined,
    });

    await app.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  },
});

export { expect } from '@playwright/test';

/** Gets past the first-run welcome, for journeys that are not about it. */
export async function skipWelcome(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'Skip' });
  await skip.waitFor({ state: 'visible' });
  await skip.click();
  await skip.waitFor({ state: 'detached' });
}

/** Runs the import wizard over whatever the tool folders hold. Leaves those folders untouched. */
export async function importEverything(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Import' }).click();
  await page.getByRole('button', { name: /Scan these/ }).click();
  await page.getByRole('button', { name: /^Import \d+$/ }).click();
  await page.getByRole('heading', { name: 'Imported' }).waitFor();
}

/** Plans a deploy from whatever screen offers it, reviews it, and applies it. */
export async function applyPlan(page: Page): Promise<void> {
  const plan = page.getByRole('dialog');
  await plan.getByRole('button', { name: /^Apply/ }).waitFor();
  await plan.getByRole('button', { name: /^Apply/ }).click();
  await page.getByRole('dialog', { name: 'Done' }).waitFor();
  await page.getByRole('button', { name: 'Close' }).click();
}

/**
 * Answers every conflict in the open plan the same way. Deploying an imported item back to the
 * tool it came from always raises them: AMC does not own those files yet, and what it compiles
 * is only semantically equal to what is there, never byte-equal.
 */
export async function resolveAll(page: Page, choice: string): Promise<number> {
  await planReady(page);
  const buttons = page.getByRole('dialog').getByRole('button', { name: choice, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i++) await buttons.nth(i).click();
  return count;
}

/** Waits for the plan dialog to stop working things out, so its contents can be read. */
export async function planReady(page: Page): Promise<void> {
  await page
    .getByRole('dialog')
    .getByText('Working out what would change')
    .waitFor({ state: 'hidden' });
}
