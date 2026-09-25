import { expect, test } from './fixtures';

test.use({ seed: true });

/**
 * J1 — first launch: welcome, what was detected, import what is already there, land on the
 * dashboard. The acceptance that matters is the last line of the journey: no files on disk have
 * been changed.
 */
test('J1: welcome, detect, import, and nothing on disk is touched', async ({ amc }) => {
  const { page } = amc;
  const before = amc.toolFiles();
  expect(Object.keys(before).length).toBeGreaterThan(5);

  const welcome = page.getByRole('dialog', { name: /Welcome to AMC/ });
  await expect(welcome.getByRole('heading', { name: /One library, every tool/ })).toBeVisible();

  await welcome.getByRole('button', { name: 'Next' }).click();
  await expect(welcome.getByRole('heading', { name: /Your library is yours/ })).toBeVisible();
  // However the platform spells a path, the library sits inside this test's own AMC home.
  await expect(welcome.getByText(/[\\/]\.amc[\\/]library$/)).toBeVisible();

  await welcome.getByRole('button', { name: 'Next' }).click();
  await expect(welcome.getByText('Claude Code', { exact: true })).toBeVisible();
  await expect(welcome.getByText('Codex CLI', { exact: true })).toBeVisible();

  await welcome.getByRole('button', { name: 'Next' }).click();
  await welcome.getByRole('button', { name: /Look at what I have/ }).click();

  // Import: scan, review, adopt.
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Scan these/ }).click();
  await expect(page.getByRole('heading', { name: /Review what was found/ })).toBeVisible();
  await expect(page.getByText('security-checklist').first()).toBeVisible();

  await page.getByRole('button', { name: /^Import \d+$/ }).click();
  await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
  await expect(page.getByText(/Your tool folders were not touched/)).toBeVisible();

  // The library has them; the tools are byte-for-byte as they were (S6).
  await page.getByRole('link', { name: /Skills/ }).click();
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
  await expect(page.getByText('security-checklist').first()).toBeVisible();

  expect(amc.toolFiles()).toEqual(before);
});
