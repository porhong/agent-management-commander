import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, planReady, resolveAll, skipWelcome, test, type AmcApp } from './fixtures';

/** Creates a skill and deploys it everywhere, which is the state both journeys start from. */
async function deployOneSkill(amc: AmcApp): Promise<void> {
  const { page } = amc;
  await skipWelcome(page);
  await page.getByRole('link', { name: /Skills/ }).click();
  await page
    .getByRole('button', { name: /New skill/ })
    .first()
    .click();

  const dialog = page.getByRole('dialog', { name: 'New skill' });
  await dialog.getByLabel('Name', { exact: true }).fill('Style Guide');
  await dialog
    .getByRole('textbox', { name: /^Description/ })
    .fill('House style for TypeScript: naming, errors, module layout.');
  await dialog.getByRole('button', { name: /Create skill/ }).click();
  await expect(page.getByRole('heading', { name: 'Style Guide' })).toBeVisible();

  await page.getByRole('button', { name: 'Instructions' }).click();
  await page.getByRole('textbox', { name: /Instructions, as markdown/ }).click();
  await page.keyboard.type('# Style\n\n- Prefer named exports');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();

  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.getByRole('button', { name: /Review the plan/ }).click();
  await planReady(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Apply/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Done' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
}

const DEPLOYED = '.claude/skills/style-guide/SKILL.md';

/**
 * J5-lite — someone edits a deployed file by hand. AMC must notice, say so, and never quietly
 * clobber it: overwriting is a decision the user makes in the plan.
 */
test('J5: an edit made outside AMC is noticed, and overwriting it is a decision', async ({
  amc,
}) => {
  const { page } = amc;
  await deployOneSkill(amc);
  expect(amc.read(DEPLOYED)).toContain('Prefer named exports');

  // The kind of thing that happens when someone opens ~/.claude in an editor.
  writeFileSync(join(amc.toolHome, DEPLOYED), '# Style\n\n- Edited by hand, outside AMC\n');

  await page.getByRole('link', { name: 'Dashboard' }).click();
  // The check runs again whenever the window regains focus.
  // Passed as source, because this file is typechecked as Node and `window` is the page's.
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(page.getByText('1 file changed outside AMC')).toBeVisible();

  await page.getByRole('link', { name: 'Matrix' }).click();
  await expect(
    page.getByRole('button', { name: /Style Guide in Claude Code · Global/ }),
  ).toHaveText(/Drifted/);

  // Deploying the item again asks rather than assuming. (Clicking the matrix cell would mean
  // something else entirely: that cell toggles whether the target holds the item at all.)
  await page.getByRole('link', { name: /Skills/ }).click();
  await page.getByText('Style Guide').first().click();
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.getByRole('button', { name: /Review the plan/ }).click();
  await planReady(page);

  const plan = page.getByRole('dialog');
  await expect(plan.getByText(/AMC wants to write its own version here/)).toBeVisible();
  await expect(plan.getByText(/edited outside AMC since it was last written/)).toBeVisible();
  await expect(plan.getByRole('button', { name: /^Apply/ })).toBeDisabled();

  // While the question is open, the hand-made edit is still there untouched.
  expect(amc.read(DEPLOYED)).toContain('Edited by hand');

  expect(await resolveAll(page, 'Overwrite')).toBe(1);
  await plan.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByRole('dialog', { name: 'Done' })).toBeVisible();

  expect(amc.read(DEPLOYED)).toContain('Prefer named exports');
  expect(amc.read(DEPLOYED)).not.toContain('Edited by hand');
});

/** Rollback — every deploy can be undone, through a plan like any other write. */
test('Rollback: reverting a deploy puts the files back', async ({ amc }) => {
  const { page } = amc;
  await deployOneSkill(amc);
  expect(amc.exists(DEPLOYED)).toBe(true);

  await page.getByRole('link', { name: 'History' }).click();
  await page.getByText(/^Deployed \d+ files?$/).click();
  await expect(page.getByText('skills/style-guide/SKILL.md').first()).toBeVisible();

  await page.getByRole('button', { name: /Revert this deploy/ }).click();
  await planReady(page);
  const plan = page.getByRole('dialog', { name: /Review the rollback/ });
  await plan.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByRole('dialog', { name: 'Done' })).toBeVisible();

  expect(amc.exists(DEPLOYED)).toBe(false);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Already reverted')).toBeVisible();
});
