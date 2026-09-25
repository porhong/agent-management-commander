import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  itemDir,
  MemFs,
  NodeFs,
  parseFrontmatter,
  readItem,
  serializeManifest,
  toLf,
  writeItem,
  type NativeGroup,
} from '@amc/core';
import { describe, expect, it } from 'vitest';
import { splitToolList } from './mapping';
import { compileItem, createClaudeCodeAdapter, parseGroup, scanRoot } from './index';

const FIXTURE_ROOT = resolve(__dirname, '../../../../fixtures/claude-code/global');
const TOOL_LIST_KEYS = ['tools', 'disallowedTools', 'allowed-tools', 'skills'];

/**
 * Semantic equality (P0-07): same frontmatter keys and values (tool lists compared as sets,
 * since Claude accepts string or list forms), and same body modulo line endings and outer
 * whitespace. Byte-equality is not the goal: YAML quoting styles differ between authors.
 */
function semantic(text: string) {
  const fm = parseFrontmatter(text);
  const data: Record<string, unknown> = { ...fm.data };
  for (const k of TOOL_LIST_KEYS) if (k in data) data[k] = splitToolList(data[k]).sort();
  return { data, body: toLf(fm.body).trim() };
}

/** native group → canonical → library folder on disk → canonical → native files. */
async function roundTrip(group: NativeGroup) {
  const { item, warnings } = parseGroup(group);
  const lib = new MemFs();
  const dir = itemDir(join('/', 'lib'), item.manifest);
  await writeItem(lib, dir, item);
  const compiled = compileItem(await readItem(lib, dir));
  return { item, warnings, compiled };
}

async function expectRoundTrip(group: NativeGroup) {
  const { compiled } = await roundTrip(group);
  expect(compiled.map((f) => f.relPath).sort()).toEqual(group.files.map((f) => f.relPath).sort());
  for (const native of group.files) {
    const out = compiled.find((f) => f.relPath === native.relPath)!;
    if (native.relPath.endsWith('.md') && native.relPath === group.entry) {
      expect(semantic(out.content.toString()), native.relPath).toEqual(
        semantic(native.content.toString('utf8')),
      );
    } else {
      // Supporting files are copied byte-for-byte.
      expect(Buffer.from(out.content).equals(native.content), native.relPath).toBe(true);
    }
  }
}

describe('Claude Code adapter: fixtures', () => {
  it('scans agents, skills and commands; skips synced skills and non-.md files', async () => {
    const groups = await scanRoot(new NodeFs(), FIXTURE_ROOT);
    expect(groups.map((g) => `${g.kind}:${g.entry}`).sort()).toEqual([
      'agent:agents/code-reviewer.md',
      'agent:agents/crlf-agent.md',
      'agent:agents/data/db-expert.md',
      'agent:agents/legacy.md',
      'command:commands/commit.md',
      'command:commands/frontend/component.md',
      'command:commands/review-pr.md',
      'skill:skills/security-checklist/SKILL.md',
      'skill:skills/style-guide/SKILL.md',
      'skill:skills/weird-body/SKILL.md',
    ]);
  });

  it('round-trips every fixture item: parse → library → compile ≈ original', async () => {
    for (const group of await scanRoot(new NodeFs(), FIXTURE_ROOT)) await expectRoundTrip(group);
  });

  it('produces reviewed canonical manifests (golden)', async () => {
    const groups = await scanRoot(new NodeFs(), FIXTURE_ROOT);
    const golden = groups
      .sort((a, b) => a.entry.localeCompare(b.entry))
      .map((g) => {
        const { item, warnings } = parseGroup(g);
        return `# ${g.entry}${warnings.length ? `\n# warnings: ${warnings.join('; ')}` : ''}\n${serializeManifest(item.manifest)}--- body ---\n${item.body}`;
      })
      .join('\n==========\n');
    expect(golden).toMatchSnapshot();
  });

  it('maps equipped skills, tiers and permissions canonically', async () => {
    const groups = await scanRoot(new NodeFs(), FIXTURE_ROOT);
    const reviewer = parseGroup(groups.find((g) => g.entry === 'agents/code-reviewer.md')!).item;
    expect(reviewer.manifest).toMatchObject({
      id: 'agent.code-reviewer',
      model: { preferred: 'powerful' },
      tools: { allow: ['read', 'search'] },
      skills: [
        { ref: 'skill.security-checklist', mode: 'always' },
        { ref: 'skill.style-guide', mode: 'always' },
      ],
    });
    const legacy = parseGroup(groups.find((g) => g.entry === 'agents/legacy.md')!).item;
    expect(legacy.manifest.slug).toBe('legacy-helper');
    const review = parseGroup(groups.find((g) => g.entry === 'commands/review-pr.md')!).item;
    expect(review.body).toContain('Review pull request {{arg1}} with focus on {{arg2}}.');
    expect(review.body).toContain('\\{{ double braces }}');
  });

  it('exposes the draft ToolAdapter surface', () => {
    const adapter = createClaudeCodeAdapter(new NodeFs());
    expect(adapter.id).toBe('claude-code');
  });
});

// Opt-in, strictly read-only check against the developer's real Claude Code setup (P0-07).
const REAL = process.env['AMC_REAL_HOME'] === '1';
describe.skipIf(!REAL)('Claude Code adapter: real ~/.claude (AMC_REAL_HOME=1)', () => {
  it('round-trips every item found', async () => {
    const root = process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
    const groups = await scanRoot(new NodeFs(), root);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) await expectRoundTrip(group);
  });
});
