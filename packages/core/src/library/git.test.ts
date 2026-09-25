import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../fs/node-fs';
import { bootstrapHome } from './bootstrap';
import { GitService } from './git';
import { LibraryService } from './service';

let home: string;
let git: GitService;
let lib: LibraryService;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'amc-git-'));
  const paths = await bootstrapHome(new NodeFs(), home);
  git = new GitService(paths.library);
  await git.init();
  lib = new LibraryService({ fs: new NodeFs(), root: paths.library, history: git });
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('GitService + LibraryService (T1.1.5)', () => {
  it('has an empty log before the first commit, and init is idempotent', async () => {
    await git.init();
    expect(await git.log()).toEqual([]);
  });

  it('auto-commits each save with the item and version in the message', async () => {
    await lib.create({ kind: 'skill', slug: 'security-checklist', description: 'x' });
    await lib.update('skill.security-checklist', { body: 'v2' });
    const log = await git.log();
    expect(log.map((e) => e.summary)).toEqual([
      'amc: update skill.security-checklist (0.1.1)',
      'amc: create skill.security-checklist (0.1.0)',
    ]);
    expect(log[0]!.itemIds).toEqual(['skill.security-checklist']);
  });

  it('does not commit when nothing changed', async () => {
    await lib.create({ kind: 'skill', slug: 's', description: 'x' });
    await lib.update('skill.s', { body: '' });
    expect(await git.log()).toHaveLength(1);
  });

  it('lists only one item’s commits, across renames', async () => {
    await lib.create({ kind: 'skill', slug: 'a', description: 'x' });
    await lib.create({ kind: 'skill', slug: 'b', description: 'x' });
    await lib.update('skill.a', { body: 'a2' });
    await lib.rename('skill.a', 'a-renamed');
    await lib.update('skill.b', { body: 'b2' });

    const hist = await lib.history('skill.a');
    expect(hist.map((e) => e.summary)).toEqual([
      'amc: rename skill.a (a → a-renamed)',
      'amc: update skill.a (0.1.1)',
      'amc: create skill.a (0.1.0)',
    ]);
    // Path-based log sees only the commits that touched that folder.
    expect((await git.log({ path: 'skills/b' })).map((e) => e.summary)).toEqual([
      'amc: update skill.b (0.1.1)',
      'amc: create skill.b (0.1.0)',
    ]);
    // The rename commit removed the old folder from the tree.
    const head = hist[0]!.rev;
    expect(await git.readDir(head, 'skills/a')).toEqual({});
    expect(Object.keys(await git.readDir(head, 'skills/a-renamed')).sort()).toEqual([
      'SKILL.md',
      'amc.yaml',
    ]);
  });

  it('restore brings back old content as a new commit and version', async () => {
    await lib.create({
      kind: 'skill',
      slug: 's',
      description: 'x',
      body: 'original',
      files: { 'references/r.md': Buffer.from('r1') },
    });
    const [created] = await lib.history('skill.s');
    await lib.update('skill.s', { body: 'edited', files: {} });
    await lib.rename('skill.s', 's-new');

    const restored = await lib.restore('skill.s', created!.rev);
    expect(restored.body).toBe('original');
    expect(restored.files['references/r.md']?.toString()).toBe('r1');
    expect(restored.manifest.slug).toBe('s-new');
    expect(restored.manifest.version).toBe('0.1.3');
    expect(await lib.get('skill.s')).toEqual(restored);

    const hist = await lib.history('skill.s');
    expect(hist).toHaveLength(4);
    expect(hist[0]!.summary).toBe(`amc: restore skill.s to ${created!.rev.slice(0, 7)} (0.1.3)`);
  });

  it('commits deletions', async () => {
    await lib.create({ kind: 'skill', slug: 's', description: 'x' });
    await lib.delete('skill.s');
    const [del] = await git.log();
    expect(del!.summary).toBe('amc: delete skill.s');
    expect(await git.readDir(del!.rev, 'skills/s')).toEqual({});
  });
});
