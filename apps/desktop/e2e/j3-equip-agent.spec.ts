import { expect, importEverything, planReady, resolveAll, skipWelcome, test } from './fixtures';

test.use({ seed: true });

/**
 * J3 — the problem case: an agent that needs skills. The whole point is that the reference is
 * declared once and each tool receives its own correct rendering, with no copy-paste.
 */
test('J3: equip an agent with a skill and see each tool get its own version', async ({ amc }) => {
  const { page } = amc;
  await skipWelcome(page);
  await importEverything(page);

  await page.getByRole('link', { name: /Agents/ }).click();
  await page.getByText('code-reviewer').first().click();
  await expect(page.getByRole('heading', { name: 'code-reviewer' })).toBeVisible();

  await page.getByRole('button', { name: 'Skills' }).click();
  await expect(page.getByRole('heading', { name: 'Equipped skills' })).toBeVisible();
  // Imported straight from the tool's own frontmatter, not guessed at — including the name,
  // which is whatever the tool called it.
  await expect(page.getByRole('link', { name: 'security-checklist' })).toBeVisible();

  // Add one more, on demand rather than always loaded.
  await page.getByRole('combobox', { name: 'Add a skill' }).selectOption('skill.weird-body');
  await expect(page.getByRole('link', { name: 'weird-body' })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();

  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.getByRole('button', { name: /Review the plan/ }).click();

  const plan = page.getByRole('dialog', { name: /Review the plan/ });
  // The fixtures are still sitting in those folders and AMC does not own them yet, so every
  // file it would write is a conflict until someone says what should happen.
  await planReady(page);
  await expect(plan.getByRole('button', { name: /^Apply/ })).toBeDisabled();
  expect(await resolveAll(page, 'Take it over')).toBeGreaterThan(0);

  await plan.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByRole('dialog', { name: 'Done' })).toBeVisible();

  // Claude Code writes an agent file that names the always-loaded skill in its frontmatter;
  // Codex has no such field, so the same agent becomes TOML with the skills inlined.
  const claude = amc.read('.claude/agents/code-reviewer.md');
  expect(claude).toContain('security-checklist');
  expect(amc.exists('.codex/agents/code-reviewer.toml')).toBe(true);

  // The referenced skills came along; the agent was never copy-pasted into them.
  expect(amc.exists('.claude/skills/security-checklist/SKILL.md')).toBe(true);
  expect(amc.exists('.claude/skills/weird-body/SKILL.md')).toBe(true);
});
