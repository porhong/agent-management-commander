import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
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
import { createClaudeCodeAdapter } from './index';

let home: string;
let svc: DeployService;
const T: Target = { toolId: 'claude-code', scope: 'global' };

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
  item('agent.reviewer', { skills: [{ ref: 'skill.sec', mode: 'always' }] }, 'You review code.\n'),
];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'amc-e2e-'));
  const fs = new NodeFs();
  svc = new DeployService({
    fs,
    paths: amcPaths(join(home, '.amc')),
    adapters: new AdapterRegistry([createClaudeCodeAdapter({ fs, home, env: {} })]),
  });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const deploy = async (items = library) => {
  const plan = await svc.plan({ items, selections: [{ target: T, items: ['agent.reviewer'] }] });
  return { plan, report: await svc.apply(plan) };
};

describe('Claude Code deploy on real disk', () => {
  it('writes native files and a lockfile, then redeploys as a no-op', async () => {
    const { report } = await deploy();
    const claude = join(home, '.claude');
    expect(readFileSync(join(claude, 'agents', 'reviewer.md'), 'utf8')).toContain(
      'skills:\n  - sec\n',
    );
    expect(readFileSync(join(claude, 'skills', 'sec', 'SKILL.md'), 'utf8')).toContain('name: sec');
    const lock = JSON.parse(readFileSync(join(claude, '.amc-lock.json'), 'utf8'));
    expect(Object.keys(lock.files)).toEqual(['agents/reviewer.md', 'skills/sec/SKILL.md']);
    expect(report.written).toHaveLength(2);

    const again = await deploy();
    expect(again.plan.targets[0]!.changes.every((c) => c.op === 'unchanged')).toBe(true);
    expect(again.report.written).toEqual([]);
  });

  it('never writes through a skills junction that leads outside ~/.claude (S4)', async () => {
    const shared = join(home, '.agents', 'skills', 'sec');
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, 'SKILL.md'), 'shared skill, owned by the user\n');
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    symlinkSync(shared, join(home, '.claude', 'skills', 'sec'), 'junction');

    const plan = await svc.plan({
      items: library,
      selections: [{ target: T, items: ['agent.reviewer'] }],
    });
    const linked = plan.targets[0]!.changes.find((c) => c.relPath === 'skills/sec/SKILL.md')!;
    expect(linked).toMatchObject({ op: 'conflict', reason: 'linked', options: ['skip'] });
    await svc.apply(plan, { [linked.id]: 'skip' });
    expect(readFileSync(join(shared, 'SKILL.md'), 'utf8')).toBe(
      'shared skill, owned by the user\n',
    );
    expect(existsSync(join(home, '.claude', 'agents', 'reviewer.md'))).toBe(true);
  });

  it('rolls back to the exact previous bytes', async () => {
    await deploy();
    const agentPath = join(home, '.claude', 'agents', 'reviewer.md');
    const v1 = readFileSync(agentPath);
    const edited = [library[0]!, { ...library[1]!, body: 'You review code carefully.\n' }];
    const { report } = await deploy(edited);
    expect(readFileSync(agentPath, 'utf8')).toContain('carefully');
    await svc.apply(await svc.planRollback(report.deployId));
    expect(readFileSync(agentPath).equals(v1)).toBe(true);
  });
});
