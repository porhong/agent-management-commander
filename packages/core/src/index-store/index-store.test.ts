import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter/registry';
import type { ToolAdapter } from '../adapter/types';
import { DeployService } from '../deploy/service';
import type { Lockfile } from '../deploy/types';
import { isAmcError } from '../errors';
import { MemFs } from '../fs/mem-fs';
import { amcPaths } from '../library/bootstrap';
import { mk } from '../test-support';
import { ftsQuery, SqliteIndexStore } from './sqlite-index';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amc-index-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const items = [
  mk(
    'skill.security-checklist',
    {
      name: 'Security Checklist',
      description: 'Review for injection and secrets.',
      tags: ['security'],
    },
    'OWASP top ten.',
  ),
  mk(
    'skill.style',
    { description: 'Naming and formatting.', tags: ['style'] },
    'Prefer named exports.',
  ),
  mk(
    'agent.reviewer',
    {
      description: 'Reviews pull requests.',
      skills: [{ ref: 'skill.security-checklist', mode: 'always' }, { ref: 'skill.style' }],
    },
    'You review.',
  ),
  mk(
    'command.review',
    { description: 'Run a review.', agent: 'agent.reviewer' },
    'Review {{args}}',
  ),
];

const entry = (itemId: string, itemVersion: string, targetId: string, deployId: string) => ({
  itemId,
  itemVersion,
  targetId,
  sha256: 'a'.repeat(64),
  deployedAt: `2026-09-25T10:00:0${deployId.slice(-1)}Z`,
  deployId,
});

const lockA: Lockfile = {
  schemaVersion: 1,
  amcVersion: '0.1.0',
  files: {
    'agents/reviewer.md': entry('agent.reviewer', '0.1.0', 'claude-code:global', 'd1'),
    'skills/security-checklist/SKILL.md': entry(
      'skill.security-checklist',
      '0.0.9',
      'claude-code:global',
      'd1',
    ),
    'skills/gone/SKILL.md': entry('skill.gone', '1.0.0', 'claude-code:global', 'd1'),
  },
  regions: {},
};
const lockB: Lockfile = {
  schemaVersion: 1,
  amcVersion: '0.1.0',
  files: { 'skills/style/SKILL.md': entry('skill.style', '0.1.0', 'codex-cli:global', 'd2') },
  regions: {
    'AGENTS.md': { 'command.review': entry('command.review', '0.1.0', 'codex-cli:global', 'd2') },
  },
};
const lockfiles = [
  { rootDir: join('/', 'h', '.claude'), lock: lockA },
  { rootDir: join('/', 'h', '.agents'), lock: lockB },
];

/** Everything a UI would query, for comparing two index instances. */
const snapshot = (s: SqliteIndexStore) => ({
  items: s.listItems(),
  skills: s.listItems({ kind: 'skill' }),
  tagged: s.listItems({ tag: 'security' }),
  search: s.search('secur'),
  uses: s.uses('agent.reviewer'),
  usedBy: s.usedBy('skill.style'),
  deployments: s.deployments(),
  matrix: s.matrix(),
  lock: s.getLockfile(join('/', 'h', '.agents')),
});

describe('SqliteIndexStore (T1.5.4)', () => {
  it('deleting index.sqlite and rebuilding gives identical query results', () => {
    const path = join(dir, 'index.sqlite');
    const first = new SqliteIndexStore(path);
    expect(first.needsRebuild).toBe(true);
    first.rebuild({ items, lockfiles });
    const before = snapshot(first);
    first.close();

    const reopened = new SqliteIndexStore(path);
    expect(reopened.needsRebuild).toBe(false);
    expect(snapshot(reopened)).toEqual(before);
    reopened.close();

    rmSync(path);
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
    const fresh = new SqliteIndexStore(path);
    expect(fresh.needsRebuild).toBe(true);
    fresh.rebuild({ items, lockfiles });
    expect(snapshot(fresh)).toEqual(before);
    fresh.close();
  });

  it('searches names, slugs, descriptions, tags, and bodies by prefix, ranked', () => {
    const s = new SqliteIndexStore(':memory:');
    s.rebuild({ items, lockfiles: [] });
    expect(s.search('secur').map((i) => i.id)).toEqual(['skill.security-checklist']);
    expect(s.search('named exports').map((i) => i.id)).toEqual(['skill.style']);
    expect(s.search('checklist').map((i) => i.id)).toEqual(['skill.security-checklist']);
    // A slug/name hit outranks a description-only hit.
    expect(s.search('review').map((i) => i.id)).toEqual([
      'agent.reviewer',
      'command.review',
      'skill.security-checklist',
    ]);
    // Operators and quotes are just text.
    expect(s.search('"OR" NEAR( * -')).toEqual([]);
    expect(ftsQuery('  ')).toBeNull();
  });

  it('keeps relations and reverse relations, updated incrementally', () => {
    const s = new SqliteIndexStore(':memory:');
    s.rebuild({ items, lockfiles: [] });
    expect(s.usedBy('skill.security-checklist').map((r) => [r.from, r.relation, r.mode])).toEqual([
      ['agent.reviewer', 'equips', 'always'],
    ]);
    s.upsertItem(mk('agent.reviewer', { description: 'x' }, ''));
    expect(s.usedBy('skill.security-checklist')).toEqual([]);
    s.removeItem('skill.style');
    expect(s.listItems().map((i) => i.id)).not.toContain('skill.style');
    expect(s.search('named')).toEqual([]);
  });

  it('derives deployments and the matrix from lockfiles in one query', () => {
    const s = new SqliteIndexStore(':memory:');
    s.rebuild({ items, lockfiles });
    expect(s.matrix().map((r) => [r.itemId, r.targetId, r.status])).toEqual([
      ['agent.reviewer', 'claude-code:global', 'in-sync'],
      ['command.review', 'codex-cli:global', 'in-sync'],
      ['skill.gone', 'claude-code:global', 'missing'],
      ['skill.security-checklist', 'claude-code:global', 'outdated'],
      ['skill.style', 'codex-cli:global', 'in-sync'],
    ]);
    expect(s.deployments({ itemId: 'command.review' })[0]!.files).toEqual([
      `${join('/', 'h', '.agents')}|AGENTS.md#command.review`,
    ]);
    s.setLockfile(join('/', 'h', '.claude'), null);
    expect(s.deployments({ targetId: 'claude-code:global' })).toEqual([]);
  });

  it('1,000 items rebuild quickly', () => {
    const s = new SqliteIndexStore(':memory:');
    const many = Array.from({ length: 1000 }, (_, i) =>
      mk(`skill.s${i}`, { description: `Skill number ${i}.` }, `Body ${i} `.repeat(50)),
    );
    const t0 = performance.now();
    s.rebuild({ items: many, lockfiles: [] });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(s.search('number').length).toBe(50);
  });
});

describe('lockfile recovery through the index mirror (T1.4.1)', () => {
  const MAIN = join('/', 'h', 'tool');
  const fake = {
    id: 'fake',
    rules: [],
    paths: () => ({ main: MAIN }),
    compile: (r: { item: { manifest: { id: string; slug: string }; body: string } }) => [
      {
        root: 'main',
        relPath: `${r.item.manifest.slug}.md`,
        content: r.item.body,
        itemId: r.item.manifest.id,
        adaptations: [],
      },
    ],
  } as unknown as ToolAdapter;

  it('a deleted lockfile puts the target on hold until restored', async () => {
    const fs = new MemFs();
    const index = new SqliteIndexStore(':memory:');
    const svc = new DeployService({
      fs,
      paths: amcPaths(join('/', 'h', '.amc')),
      adapters: new AdapterRegistry([fake]),
      lockMirror: { get: (d) => index.getLockfile(d), set: (d, l) => index.setLockfile(d, l) },
    });
    const sel = {
      items: [mk('skill.a', {}, 'A')],
      selections: [{ target: { toolId: 'fake', scope: 'global' as const }, items: ['skill.a'] }],
    };
    await svc.apply(await svc.plan(sel));
    expect(index.deployments().map((d) => d.itemId)).toEqual(['skill.a']);

    await fs.rm(join(MAIN, '.amc-lock.json'));
    const held = await svc.plan(sel);
    expect(held.targets[0]).toMatchObject({ status: 'needs-attention', changes: [] });
    expect(held.targets[0]!.message).toContain('remembers 1 owned file');

    await svc.restoreLockfile(MAIN);
    const ok = await svc.plan(sel);
    expect(ok.targets[0]!.changes.map((c) => c.op)).toEqual(['unchanged']);

    await fs.rm(join(MAIN, '.amc-lock.json'));
    svc.forgetLockfile(MAIN);
    const forgotten = await svc.plan(sel);
    // Without ownership the existing file is foreign, but identical, so it is adopted.
    expect(forgotten.targets[0]!.changes[0]).toMatchObject({ op: 'unchanged', adopt: true });
    await expect(svc.restoreLockfile(MAIN)).rejects.toSatisfy((e) =>
      isAmcError(e, 'DEPLOY_NOT_FOUND'),
    );
  });
});
