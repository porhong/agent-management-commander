import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdapterRegistry,
  amcPaths,
  DeployService,
  NodeFs,
  parseManifest,
  type LibraryItem,
  type Target,
} from '@amc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexAdapter, parseToml } from './index';

let home: string;
let svc: DeployService;

const item = (id: string, fields: Record<string, unknown>, body: string): LibraryItem => {
  const [kind, slug] = id.split('.') as [string, string];
  return {
    manifest: parseManifest({
      id,
      kind,
      slug,
      name: slug,
      description: `Use for ${slug} work.`,
      ...fields,
    }),
    body,
    files: {},
  };
};

const library = [
  item('skill.sec', {}, '# Security\n\n- Check inputs\n'),
  item(
    'agent.reviewer',
    { skills: [{ ref: 'skill.sec', mode: 'always' }], tools: { allow: ['read', 'search'] } },
    'You review code.\n',
  ),
  item(
    'command.review',
    { arguments: [{ name: 'pr' }], agent: 'agent.reviewer' },
    'Review {{pr}}.',
  ),
];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'amc-e2e-codex-'));
  const fs = new NodeFs();
  svc = new DeployService({
    fs,
    paths: amcPaths(join(home, '.amc')),
    adapters: new AdapterRegistry([createCodexAdapter({ fs, home, env: {} })]),
  });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('Codex deploy on real disk', () => {
  it('writes into both roots with one lockfile each', async () => {
    const T: Target = { toolId: 'codex-cli', scope: 'global' };
    const plan = await svc.plan({
      items: library,
      selections: [{ target: T, items: ['command.review'] }],
    });
    const report = await svc.apply(plan);
    expect(
      report.written
        .map((p) =>
          p
            .slice(home.length + 1)
            .split('\\')
            .join('/'),
        )
        .sort(),
    ).toEqual([
      '.agents/skills/sec/SKILL.md',
      '.codex/agents/reviewer.toml',
      '.codex/prompts/review.md',
    ]);
    const toml = parseToml(
      readFileSync(join(home, '.codex', 'agents', 'reviewer.toml'), 'utf8'),
      'x',
    );
    expect(toml).toMatchObject({ name: 'reviewer', sandbox_mode: 'read-only' });
    expect(toml['developer_instructions']).toContain('- Check inputs');
    expect(readFileSync(join(home, '.codex', 'prompts', 'review.md'), 'utf8')).toContain(
      'Review $PR.',
    );
    for (const root of ['.codex', '.agents']) {
      expect(existsSync(join(home, root, '.amc-lock.json'))).toBe(true);
    }
  });

  it('keeps a project target under its root and compiles commands to skills', async () => {
    const project = join(home, 'work', 'api');
    const T: Target = { toolId: 'codex-cli', scope: 'project', root: project };
    const plan = await svc.plan({
      items: library,
      selections: [{ target: T, items: ['command.review'] }],
    });
    const report = await svc.apply(plan);
    for (const p of report.written) expect(p.startsWith(project)).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });
});
