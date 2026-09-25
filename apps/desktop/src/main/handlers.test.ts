import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAmcError, type AdapterHost, type NodeFs } from '@amc/core';
import { NodeFs as Fs } from '@amc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL_NAMES } from '../shared/channels';
import { CHANNELS, eventContract, ipcContract, type EventName } from '../shared/ipc-contract';
import { createAppServices, type AppServices } from './app-services';
import { createHandlers, type HandlerMap } from './handlers';
import { PathTokenRegistry } from './path-tokens';

let home: string;
let services: AppServices;
let h: HandlerMap;
let picked: string | null;
const events: Array<{ name: EventName; payload: unknown }> = [];

const host = (h: string): AdapterHost => ({
  fs: new Fs() as NodeFs,
  home: h,
  env: {},
  runVersion: async () => null,
});

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'amc-app-'));
  picked = join(home, 'work', 'api');
  events.length = 0;
  services = await createAppServices({
    home: join(home, '.amc'),
    host: host(home),
    indexPath: ':memory:',
    emit: (name, payload) => events.push({ name, payload }),
  });
  h = createHandlers({
    services,
    dialog: { pickFolder: async () => picked },
    probe: () => ({
      versions: { electron: '44.4.5', node: '24.21.0', chrome: '142' },
      sqlite: { ok: true, version: '3.53.4', fts5: true },
    }),
  });
});

afterEach(() => {
  services.close();
  rmSync(home, { recursive: true, force: true });
});

const emitted = (name: EventName) => events.filter((e) => e.name === name);

describe('IPC contract (T1.5.2)', () => {
  it('the preload channel list matches the contract exactly', () => {
    expect([...CHANNEL_NAMES].sort()).toEqual([...CHANNELS].sort());
  });

  it('every channel has a handler, and every event payload validates', () => {
    for (const channel of CHANNELS) expect(typeof h[channel]).toBe('function');
    expect(
      eventContract['library.changed'].safeParse({ ids: ['skill.a'], reason: 'create' }).success,
    ).toBe(true);
    expect(
      eventContract['library.changed'].safeParse({ ids: ['nope'], reason: 'create' }).success,
    ).toBe(false);
  });

  it('rejects inputs that do not match the schema, including path-shaped ones', () => {
    const bad: Array<[keyof typeof ipcContract, unknown]> = [
      ['library.get', { id: '../../etc/passwd' }],
      ['library.get', { id: 'skill' }],
      ['library.create', { kind: 'skill', slug: 'Not A Slug' }],
      ['library.rename', { id: 'skill.a', slug: '../escape' }],
      ['targets.addProject', { token: 'C:/Users/dev' }],
      ['deploy.plan', { selections: [] }],
      [
        'compile.preview',
        { id: 'skill.a', target: { toolId: 'claude-code', scope: 'project', root: 'C:/x' } },
      ],
    ];
    for (const [channel, input] of bad) {
      expect(
        ipcContract[channel].input.safeParse(input).success,
        `${channel} ${JSON.stringify(input)}`,
      ).toBe(false);
    }
    expect(ipcContract['library.get'].input.safeParse({ id: 'skill.a' }).success).toBe(true);
  });

  it('a project target reaches main only as a dialog token', async () => {
    const registry = new PathTokenRegistry();
    expect(() => registry.resolve('tok_' + '0'.repeat(32))).toThrow(/Pick the folder again/);
    const token = registry.issue(join(home, 'work'));
    expect(registry.resolve(token)).toBe(join(home, 'work'));
    expect(registry.issue(join(home, 'work'))).toBe(token);
    expect(() => registry.issue('relative/path')).toThrow(/relative path/);

    const result = await h['dialog.pickFolder']({});
    expect(result?.path).toBe(picked);
    expect(result?.token).toMatch(/^tok_[0-9a-f]{32}$/);
    await expect(h['targets.addProject']({ token: 'tok_' + 'f'.repeat(32) })).rejects.toThrow(
      /Unknown or expired/,
    );
  });
});

describe('library handlers', () => {
  it('creates, reads, renames, and deletes through the index', async () => {
    const created = await h['library.create']({
      kind: 'skill',
      slug: 'sec',
      description: 'Review for security issues.',
    });
    expect(created.manifest['id']).toBe('skill.sec');
    expect(emitted('library.changed').at(-1)!.payload).toEqual({
      ids: ['skill.sec'],
      reason: 'create',
    });

    expect((await h['library.list']({})).map((r) => r.id)).toEqual(['skill.sec']);
    expect((await h['library.search']({ query: 'secur' })).map((r) => r.id)).toEqual(['skill.sec']);
    expect((await h['library.get']({ id: 'skill.sec' })).body).toBe('');

    await h['library.update']({ id: 'skill.sec', body: '# Checklist\n' });
    const renamed = await h['library.rename']({ id: 'skill.sec', slug: 'security-checklist' });
    expect(renamed.manifest['slug']).toBe('security-checklist');
    expect((await h['library.list']({}))[0]!.slug).toBe('security-checklist');

    const history = await h['library.history']({ id: 'skill.sec' });
    expect(history.length).toBeGreaterThanOrEqual(3);
    const restored = await h['library.restore']({ id: 'skill.sec', rev: history.at(-1)!.rev });
    expect(restored.body).toBe('');

    await h['library.delete']({ id: 'skill.sec' });
    expect(await h['library.list']({})).toEqual([]);
  });

  it('reports relations and validation issues', async () => {
    await h['library.create']({
      kind: 'skill',
      slug: 'sec',
      description: 'Review for security issues here.',
    });
    await h['library.create']({
      kind: 'agent',
      slug: 'rev',
      description: 'Reviews code for problems.',
      fields: { skills: [{ ref: 'skill.sec', mode: 'always' }] },
    });
    expect(await h['library.relations']({ id: 'skill.sec' })).toEqual({
      uses: [],
      usedBy: [{ id: 'agent.rev', relation: 'equips', mode: 'always' }],
    });
    await h['library.create']({ kind: 'skill', slug: 'tiny', description: 'Too short' });
    const { issues } = await h['library.validate']();
    expect(issues.some((i) => i.ruleId === 'description-min' && i.itemId === 'skill.tiny')).toBe(
      true,
    );
  });

  it('surfaces core errors as AmcError, so the router can serialize the code', async () => {
    await h['library.create']({
      kind: 'skill',
      slug: 'a',
      description: 'A skill description here.',
    });
    await expect(
      h['library.create']({ kind: 'skill', slug: 'a', description: 'Another one here.' }),
    ).rejects.toSatisfy((e) => isAmcError(e, 'SLUG_TAKEN'));
    await expect(h['library.get']({ id: 'skill.nope' })).rejects.toSatisfy((e) =>
      isAmcError(e, 'ITEM_NOT_FOUND'),
    );
  });
});

describe('targets, preview, and deploy handlers', () => {
  const seed = async () => {
    await h['library.create']({
      kind: 'skill',
      slug: 'sec',
      description: 'Review for security issues.',
      body: '# Sec\n',
    });
    await h['library.create']({
      kind: 'agent',
      slug: 'rev',
      description: 'Reviews code for problems.',
      fields: { skills: [{ ref: 'skill.sec', mode: 'always' }] },
      body: 'You review.\n',
    });
  };

  it('lists global targets and registers a project from a token', async () => {
    expect((await h['targets.list']()).map((t) => t.targetId)).toEqual([
      'claude-code:global',
      'codex-cli:global',
    ]);
    const { token } = (await h['dialog.pickFolder']({}))!;
    expect(await h['targets.addProject']({ token })).toEqual({ added: true, root: picked });
    expect(await h['targets.addProject']({ token })).toEqual({ added: false, root: picked });
    expect((await h['targets.list']()).map((t) => t.targetId)).toContain(
      `claude-code:project:${picked}`,
    );
    expect(emitted('targets.changed')).toHaveLength(1);

    // Removing only stops managing it: no files are touched (T1.7.1).
    mkdirSync(join(picked!, '.claude'), { recursive: true });
    writeFileSync(join(picked!, '.claude', 'keep.md'), 'mine');
    expect(await h['targets.removeProject']({ root: picked! })).toEqual({ removed: true });
    expect(readFileSync(join(picked!, '.claude', 'keep.md'), 'utf8')).toBe('mine');
  });

  it('previews compiled output without writing anything', async () => {
    await seed();
    const { files } = await h['compile.preview']({
      id: 'agent.rev',
      target: { toolId: 'claude-code', scope: 'global' },
    });
    expect(files.map((f) => f.relPath)).toEqual(['agents/rev.md']);
    expect(files[0]!.content).toContain('skills:\n  - sec\n');
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('previews an unsaved draft without committing it to the library', async () => {
    await seed();
    const saved = await h['library.get']({ id: 'agent.rev' });
    const { files } = await h['compile.preview']({
      id: 'agent.rev',
      target: { toolId: 'claude-code', scope: 'global' },
      draft: {
        manifest: { ...saved.manifest, description: 'Only in the editor.' },
        body: 'Draft body.\n',
      },
    });
    expect(files[0]!.content).toContain('Only in the editor.');
    expect(files[0]!.content).toContain('Draft body.');
    // The equipped skill still resolves, and the library itself is untouched.
    expect(files[0]!.content).toContain('skills:\n  - sec\n');
    expect((await h['library.get']({ id: 'agent.rev' })).body).toBe('You review.\n');
  });

  it('reads an item at an older revision without changing the working tree', async () => {
    await seed();
    await h['library.update']({ id: 'skill.sec', body: '# Sec v2\n' });
    const [, first] = await h['library.history']({ id: 'skill.sec' });
    const older = await h['library.at']({ id: 'skill.sec', rev: first!.rev });
    expect(older.body).toBe('# Sec\n');
    expect((await h['library.get']({ id: 'skill.sec' })).body).toBe('# Sec v2\n');
  });

  it('plans, applies, and keeps the plan in main (the renderer only sees a planId)', async () => {
    await seed();
    const plan = await h['deploy.plan']({
      selections: [{ target: { toolId: 'claude-code', scope: 'global' }, items: ['agent.rev'] }],
    });
    expect(plan.targets[0]!.label).toBe('Claude Code · Global');
    expect(plan.targets[0]!.changes.map((c) => `${c.op}:${c.relPath}`)).toEqual([
      'create:agents/rev.md',
      'create:skills/sec/SKILL.md',
    ]);
    expect(plan.targets[0]!.changes[0]!.after).toContain('You review.');

    const report = await h['deploy.apply']({ planId: plan.planId });
    expect(report.written).toHaveLength(2);
    expect(readFileSync(join(home, '.claude', 'skills', 'sec', 'SKILL.md'), 'utf8')).toContain(
      '# Sec',
    );

    // The plan is consumed; replaying the id fails rather than writing twice.
    await expect(h['deploy.apply']({ planId: plan.planId })).rejects.toSatisfy((e) =>
      isAmcError(e, 'PLAN_STALE'),
    );

    expect(await h['deploy.matrix']()).toEqual([
      {
        itemId: 'agent.rev',
        targetId: 'claude-code:global',
        deployedVersion: '0.1.0',
        libraryVersion: '0.1.0',
        status: 'in-sync',
      },
      {
        itemId: 'skill.sec',
        targetId: 'claude-code:global',
        deployedVersion: '0.1.0',
        libraryVersion: '0.1.0',
        status: 'in-sync',
      },
    ]);

    const history = await h['deploy.history']();
    expect(history[0]).toMatchObject({ deployId: report.deployId, kind: 'deploy', fileCount: 2 });
    expect(await h['deploy.incomplete']()).toEqual([]);

    const rollback = await h['deploy.planRollback']({ deployId: report.deployId });
    expect(rollback.kind).toBe('rollback');
    await h['deploy.apply']({ planId: rollback.planId });
    expect(existsSync(join(home, '.claude', 'skills', 'sec', 'SKILL.md'))).toBe(false);
    expect(await h['deploy.matrix']()).toEqual([]);
  });

  it('an outdated item shows in the matrix after editing the library', async () => {
    await seed();
    const plan = await h['deploy.plan']({
      selections: [{ target: { toolId: 'claude-code', scope: 'global' }, items: ['skill.sec'] }],
    });
    await h['deploy.apply']({ planId: plan.planId });
    await h['library.update']({ id: 'skill.sec', body: '# Sec v2\n' });
    expect((await h['deploy.matrix']())[0]).toMatchObject({
      status: 'outdated',
      deployedVersion: '0.1.0',
      libraryVersion: '0.1.1',
    });
  });
});

describe('system and settings handlers', () => {
  it('reports status, settings, and diagnostics without file contents', async () => {
    await h['library.create']({
      kind: 'skill',
      slug: 'sec',
      description: 'A secret-free description.',
      body: 'SECRET BODY',
    });
    expect(await h['system.status']()).toMatchObject({
      ready: true,
      counts: { items: 1, targets: 2 },
    });
    expect(await h['settings.get']()).toMatchObject({ theme: 'system', autoApply: 'ask' });
    expect(await h['settings.update']({ patch: { theme: 'dark' } })).toMatchObject({
      theme: 'dark',
    });

    const { text } = await h['system.diagnostics']();
    expect(text).toContain('# AMC diagnostics');
    expect(text).toContain('claude-code');
    expect(text).not.toContain('SECRET BODY');
    expect(await h['index.rebuild']()).toMatchObject({ items: 1 });
  });
});
