import { expect, planReady, skipWelcome, test } from './fixtures';

/**
 * J2 — write a skill once and deploy it everywhere. The point of the journey is the last step:
 * two tools, two different file layouts, one thing written by hand.
 */
test('J2: create a skill and deploy it to every tool', async ({ amc }) => {
  const { page } = amc;
  await skipWelcome(page);

  await page.getByRole('link', { name: /Skills/ }).click();
  await page
    .getByRole('button', { name: /New skill/ })
    .first()
    .click();

  const dialog = page.getByRole('dialog', { name: 'New skill' });
  await dialog.getByLabel('Name', { exact: true }).fill('Release Checklist');
  await dialog
    .getByRole('textbox', { name: /^Description/ })
    .fill('Use before tagging a release: changelog, version bump, smoke test.');
  await expect(dialog.getByRole('textbox', { name: /^Slug/ })).toHaveValue('release-checklist');
  await dialog.getByRole('button', { name: /Create skill/ }).click();

  // The editor opens on the new item.
  await expect(page.getByRole('heading', { name: 'Release Checklist' })).toBeVisible();
  await expect(page.getByText('skill.release-checklist')).toBeVisible();

  await page.getByRole('button', { name: 'Instructions' }).click();
  await page.getByRole('textbox', { name: /Instructions, as markdown/ }).click();
  await page.keyboard.type('# Release checklist\n\n- Update the changelog\n- Bump the version');

  // The preview compiles the draft before anything is saved.
  await expect(page.getByText('skills/release-checklist/SKILL.md')).toBeVisible();
  await expect(page.getByText('Update the changelog')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();

  // Deploy to everything that was detected.
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deploy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Review the plan/ }).click();

  const plan = page.getByRole('dialog', { name: /Review the plan/ });
  await planReady(page);
  await expect(plan.getByText('skills/release-checklist/SKILL.md').first()).toBeVisible();
  await plan.getByRole('button', { name: /^Apply/ }).click();
  // The dialog becomes the report, so it is no longer titled "Review the plan".
  await expect(page.getByRole('dialog', { name: 'Done' }).getByText(/finished/)).toBeVisible();

  // Claude Code and Codex each got their own copy, in their own place.
  expect(amc.exists('.claude/skills/release-checklist/SKILL.md')).toBe(true);
  expect(amc.exists('.agents/skills/release-checklist/SKILL.md')).toBe(true);

  const claude = amc.read('.claude/skills/release-checklist/SKILL.md');
  expect(claude).toContain('name: release-checklist');
  expect(claude).toContain('Update the changelog');
});
