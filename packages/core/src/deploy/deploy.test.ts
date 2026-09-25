import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter/registry';
import { readRegion } from '../adapter/regions';
import type { CompiledFile, Target, ToolAdapter } from '../adapter/types';
import { isAmcError } from '../errors';
import { MemFs } from '../fs/mem-fs';
import { amcPaths } from '../library/bootstrap';
import type { LibraryItem } from '../library/item-io';
import { mk } from '../test-support';
import { LOCKFILE, parseLockfile, serializeLockfile } from './lockfile';
import { DeployService } from './service';
import type { ConflictChange, DeployPlan, FileChange } from './types';

const HOME = join('/', 'h');
const PATHS = amcPaths(join(HOME, '.amc'));
/** MemFs records resolved paths (with a drive letter on Windows). */
const AMC_HOME = resolve(HOME, '.amc');
const isState = (p: string) => resolve(p).startsWith(AMC_HOME);
const MAIN = join(HOME, 'tool');
const SHARED = join(HOME, 'shared');
const T: Target = { toolId: 'fake', scope: 'global' };
const TID = 'fake:global';

/** Minimal adapter: skills and agents are files under `main`; commands are regions in `shared/AGENTS.md`. */
const fake: ToolAdapter = {
  id: 'fake',
  displayName: 'Fake',
  capabilities: {} as ToolAdapter['capabilities'],
  rules: [],
  detect: async () => ({ installed: true, roots: {}, notes: [] }),
  paths: () => ({ main: MAIN, shared: SHARED }),
  scan: async () => [],
  parse: () => {
    throw new Error('unused');
  },
  compile: (r) => {
    const m = r.item.manifest;
    const f = (
      root: string,
      relPath: string,
      content: string | Buffer,
      region?: string,
    ): CompiledFile => ({
      root,
      relPath,
      content,
      itemId: m.id,
      adaptations: [],
      ...(region && { region }),
    });
    if (m.kind === 'skill') {
      return [
        f('main', `skills/${m.slug}/SKILL.md`, r.item.body),
        ...Object.entries(r.item.files).map(([rel, data]) =>
          f('main', `skills/${m.slug}/${rel}`, data),
        ),
      ];
    }
    if (m.kind === 'agent') return [f('main', `agents/${m.slug}.md`, r.item.body)];
    return [f('shared', 'AGENTS.md', r.item.body, m.id)];
  },
};

function setup(files: Record<string, string | Buffer> = {}, fs = new MemFs(files)) {
  let clock = Date.parse('2026-09-25T10:00:00Z');
  let n = 0;
  const svc = new DeployService({
    fs,
    paths: PATHS,
    adapters: new AdapterRegistry([fake]),
    now: () => new Date((clock += 1000)),
    newId: () => `id${String(++n).padStart(4, '0')}`,
  });
  const deploy = async (items: LibraryItem[], ids = items.map((i) => i.manifest.id), res = {}) => {
    const plan = await svc.plan({ items, selections: [{ target: T, items: ids }] });
    return { plan, report: await svc.apply(plan, res) };
  };
  return { fs, svc, deploy };
}

const S = (slug: string, body = `${slug} v1\n`, extra = {}) => mk(`skill.${slug}`, extra, body);
const at = (...p: string[]) => join(MAIN, ...p);
const text = async (fs: MemFs, p: string) => (await fs.readFile(p)).toString('utf8');
const ops = (plan: DeployPlan) =>
  plan.targets[0]!.changes.map((c) => `${c.op}:${c.relPath}${c.region ? '#' + c.region : ''}`);
/** Paths written/removed outside AMC's own state and snapshot folders. */
const targetOps = (fs: MemFs) => fs.ops.filter((o) => !isState(o.path));

describe('lockfile (T1.4.1)', () => {
  const entry = {
    itemId: 'skill.a',
    itemVersion: '1.0.0',
    sha256: 'a'.repeat(64),
    deployedAt: 'x',
  };

  it('round-trips v1 with stable key order', () => {
    const lock = parseLockfile(
      JSON.stringify({
        schemaVersion: 1,
        amcVersion: '0.1.0',
        files: { 'b.md': { ...entry, targetId: 't' }, 'a.md': { ...entry, targetId: 't' } },
      }),
    );
    const text1 = serializeLockfile(lock);
    expect(Object.keys(JSON.parse(text1).files)).toEqual(['a.md', 'b.md']);
    expect(serializeLockfile(parseLockfile(text1))).toBe(text1);
  });

  it('migrates the concept-doc layout (no schemaVersion, one target)', () => {
    const lock = parseLockfile(
      JSON.stringify({
        amcVersion: '0.0.9',
        target: 'claude-code:global',
        files: { 'a.md': entry },
      }),
    );
    expect(lock.files['a.md']).toEqual({ ...entry, targetId: 'claude-code:global' });
  });

  it('rejects corrupt JSON, bad entries, and future versions', () => {
    for (const bad of [
      '{',
      '[]',
      JSON.stringify({ schemaVersion: 1, amcVersion: 'x', files: { a: { itemId: 'nope' } } }),
      JSON.stringify({ schemaVersion: 2 }),
    ]) {
      expect(() => parseLockfile(bad)).toThrow(expect.objectContaining({ code: 'LOCK_CORRUPT' }));
    }
  });

  it('a corrupt lockfile puts the target on hold: needs attention, no writes', async () => {
    const { fs, svc } = setup({ [at(LOCKFILE)]: '{ nope' });
    const plan = await svc.plan({
      items: [S('a')],
      selections: [{ target: T, items: ['skill.a'] }],
    });
    expect(plan.targets[0]).toMatchObject({ status: 'needs-attention', changes: [] });
    expect(plan.issues.some((i) => i.ruleId === 'lockfile' && !i.blocking)).toBe(true);
    await svc.apply(plan);
    expect(targetOps(fs)).toEqual([]);
  });
});

describe('plan (T1.4.2–T1.4.4)', () => {
  it('creates on first deploy, then is fully unchanged and writes nothing', async () => {
    const { fs, svc, deploy } = setup();
    const items = [S('a', 'A\n', { tags: ['x'] }), S('b')];
    const { plan, report } = await deploy(items);
    expect(ops(plan)).toEqual(['create:skills/a/SKILL.md', 'create:skills/b/SKILL.md']);
    expect(report.written).toEqual([at('skills', 'a', 'SKILL.md'), at('skills', 'b', 'SKILL.md')]);
    expect(await text(fs, at('skills', 'a', 'SKILL.md'))).toBe('A\n');
    const lock = parseLockfile(await text(fs, at(LOCKFILE)));
    expect(lock.files['skills/a/SKILL.md']).toMatchObject({
      itemId: 'skill.a',
      targetId: TID,
      deployId: report.deployId,
    });

    const before = fs.ops.length;
    const again = await svc.plan({
      items,
      selections: [{ target: T, items: ['skill.a', 'skill.b'] }],
    });
    expect(ops(again)).toEqual(['unchanged:skills/a/SKILL.md', 'unchanged:skills/b/SKILL.md']);
    await svc.apply(again);
    expect(fs.ops.length).toBe(before);
  });

  it('includes the closure: selecting an agent deploys its skills', async () => {
    const { deploy } = setup();
    const { plan } = await deploy(
      [S('a'), mk('agent.x', { skills: [{ ref: 'skill.a' }] }, 'X')],
      ['agent.x'],
    );
    expect(ops(plan)).toEqual(['create:agents/x.md', 'create:skills/a/SKILL.md']);
  });

  it('updates owned files and deletes owned files no longer selected (T1.4.3)', async () => {
    const { fs, svc, deploy } = setup();
    await deploy(
      [S('a'), S('b', 'b\n', {}), S('c')].map((s) => ({
        ...s,
        files: (s.manifest.slug === 'b' ? { 'r.md': Buffer.from('r') } : {}) as Record<
          string,
          Buffer
        >,
      })),
    );
    fs.putSync(at('skills', 'foreign', 'SKILL.md'), 'mine');
    const plan = await svc.plan({
      items: [S('a', 'A v2\n'), S('c')],
      selections: [{ target: T, items: ['skill.a', 'skill.c'] }],
    });
    expect(ops(plan)).toEqual([
      'update:skills/a/SKILL.md',
      'delete:skills/b/SKILL.md',
      'delete:skills/b/r.md',
      'unchanged:skills/c/SKILL.md',
    ]);
    await svc.apply(plan);
    expect(await fs.stat(at('skills', 'b'))).toBeNull(); // emptied folder is removed
    expect(await text(fs, at('skills', 'foreign', 'SKILL.md'))).toBe('mine');
    expect(parseLockfile(await text(fs, at(LOCKFILE))).files['skills/b/SKILL.md']).toBeUndefined();
  });

  it('turns a foreign file in the way into a conflict; identical foreign files are adopted', async () => {
    const { svc } = setup({
      [at('skills', 'a', 'SKILL.md')]: 'hand-made\n',
      [at('skills', 'b', 'SKILL.md')]: 'b v1\n',
    });
    const plan = await svc.plan({
      items: [S('a'), S('b')],
      selections: [{ target: T, items: ['skill.a', 'skill.b'] }],
    });
    const [a, b] = plan.targets[0]!.changes as [ConflictChange, FileChange];
    expect(a).toMatchObject({
      op: 'conflict',
      reason: 'foreign',
      pending: 'update',
      options: ['adopt-replace', 'rename', 'skip'],
      before: 'hand-made\n',
    });
    expect(b).toMatchObject({ op: 'unchanged', adopt: true });
  });

  it('turns an edited owned file into a drift conflict', async () => {
    const { fs, svc, deploy } = setup();
    await deploy([S('a')]);
    fs.putSync(at('skills', 'a', 'SKILL.md'), 'edited by hand\n');
    const plan = await svc.plan({
      items: [S('a', 'library v2\n')],
      selections: [{ target: T, items: ['skill.a'] }],
    });
    expect(plan.targets[0]!.changes[0]).toMatchObject({
      op: 'conflict',
      reason: 'drifted',
      options: ['overwrite', 'skip'],
    });
    // A drifted file whose item is deselected is a conflict too, never a silent delete.
    const del = await svc.plan({ items: [], selections: [{ target: T, items: [] }] });
    expect(del.targets[0]!.changes[0]).toMatchObject({
      op: 'conflict',
      reason: 'drifted',
      pending: 'delete',
    });
  });

  it('a broken selection needs attention instead of deleting what is deployed', async () => {
    const { svc, deploy } = setup();
    await deploy([S('a')]);
    const plan = await svc.plan({
      items: [mk('agent.x', { skills: [{ ref: 'skill.gone' }] })],
      selections: [{ target: T, items: ['agent.x'] }],
    });
    expect(plan.targets[0]).toMatchObject({ status: 'needs-attention', changes: [] });
    expect(plan.issues.some((i) => i.blocking)).toBe(true);
  });

  it('is deterministic', async () => {
    const items = [S('z'), S('a'), S('m')];
    const one = await setup().svc.plan({
      items,
      selections: [{ target: T, items: ['skill.z', 'skill.a', 'skill.m'] }],
    });
    const two = await setup().svc.plan({
      items: [...items].reverse(),
      selections: [{ target: T, items: ['skill.m', 'skill.a', 'skill.z'] }],
    });
    expect({ ...one, planId: '' }).toEqual({ ...two, planId: '' });
  });
});

describe('apply (T1.4.5) and safety invariants', () => {
  it('refuses unresolved conflicts, then applies each resolution', async () => {
    const files = {
      [at('skills', 'a', 'SKILL.md')]: 'A0',
      [at('skills', 'b', 'SKILL.md')]: 'B0',
      [at('skills', 'c', 'SKILL.md')]: 'C0',
    };
    const { fs, svc } = setup(files);
    const items = [S('a'), S('b'), S('c')];
    const plan = await svc.plan({
      items,
      selections: [{ target: T, items: ['skill.a', 'skill.b', 'skill.c'] }],
    });
    await expect(svc.apply(plan)).rejects.toSatisfy((e) => isAmcError(e, 'CONFLICTS_UNRESOLVED'));
    expect(targetOps(fs)).toEqual([]);
    const [a, b, c] = plan.targets[0]!.changes.map((x) => x.id);
    const report = await svc.apply(plan, { [a!]: 'adopt-replace', [b!]: 'rename', [c!]: 'skip' });
    expect(await text(fs, at('skills', 'a', 'SKILL.md'))).toBe('a v1\n');
    expect(await text(fs, at('skills', 'b', 'SKILL.md'))).toBe('b v1\n');
    expect(await text(fs, at('skills', 'b', 'SKILL.md.amc-backup'))).toBe('B0');
    expect(await text(fs, at('skills', 'c', 'SKILL.md'))).toBe('C0');
    expect(report.skipped).toEqual([`${TID}:skills/c/SKILL.md`]);
    const lock = parseLockfile(await text(fs, at(LOCKFILE)));
    expect(Object.keys(lock.files)).toEqual(['skills/a/SKILL.md', 'skills/b/SKILL.md']);
  });

  it('S5: a stale plan performs zero writes', async () => {
    const { fs, svc } = setup();
    const plan = await svc.plan({
      items: [S('a')],
      selections: [{ target: T, items: ['skill.a'] }],
    });
    fs.putSync(at('skills', 'a', 'SKILL.md'), 'appeared meanwhile');
    const opsBefore = fs.ops.length;
    await expect(svc.apply(plan)).rejects.toSatisfy((e) => isAmcError(e, 'PLAN_STALE'));
    expect(fs.ops.length).toBe(opsBefore);
  });

  it('refuses plans with blocking issues', async () => {
    const { fs, svc } = setup();
    const secret = S('a', 'key ' + 'AKIA' + 'Q'.repeat(16), { scripts: { trust: 'untrusted' } });
    secret.files = { 'scripts/x.ps1': Buffer.from('x') };
    const plan = await svc.plan({
      items: [secret],
      selections: [{ target: T, items: ['skill.a'] }],
    });
    await expect(svc.apply(plan)).rejects.toSatisfy((e) => isAmcError(e, 'PLAN_BLOCKED'));
    expect(targetOps(fs)).toEqual([]);
  });

  it('S2: every modified or deleted file is snapshotted before the first target write', async () => {
    const { fs, svc, deploy } = setup();
    await deploy([S('a'), S('b')]);
    const mark = fs.ops.length;
    const plan = await svc.plan({
      items: [S('a', 'v2\n')],
      selections: [{ target: T, items: ['skill.a'] }],
    });
    const { deployId } = await svc.apply(plan);
    const newOps = fs.ops.slice(mark);
    const firstTarget = newOps.findIndex((o) => !isState(o.path));
    const snapshotWrites = newOps.slice(0, firstTarget).map((o) => o.path);
    const m = await svc.readManifest(deployId);
    for (const e of m.entries.filter((x) => x.existed)) {
      expect(snapshotWrites).toContain(resolve(PATHS.snapshots, deployId, 'before', e.beforeFile!));
    }
    expect(m.entries.map((e) => `${e.relPath}:${e.existed}`).sort()).toEqual([
      `${LOCKFILE}:true`,
      'skills/a/SKILL.md:true',
      'skills/b/SKILL.md:true',
    ]);
  });

  it('S4: never writes through a link that leaves the root', async () => {
    const { fs, svc } = setup();
    const outside = join('/', 'elsewhere');
    fs.linkSync(at('skills', 'a'), outside);
    const plan = await svc.plan({
      items: [S('a'), S('b')],
      selections: [{ target: T, items: ['skill.a', 'skill.b'] }],
    });
    expect(plan.targets[0]!.changes[0]).toMatchObject({
      op: 'conflict',
      reason: 'linked',
      options: ['skip'],
    });
    // A link that appears after planning is caught by apply before any write.
    const clean = await setup().svc.plan({
      items: [S('c')],
      selections: [{ target: T, items: ['skill.c'] }],
    });
    const later = setup();
    later.fs.linkSync(at('skills', 'c'), outside);
    await expect(later.svc.apply(clean)).rejects.toSatisfy((e) =>
      isAmcError(e, 'PATH_OUTSIDE_ROOT'),
    );
    expect(later.fs.ops).toEqual([]);
  });

  it('S1 (property): foreign files are never modified, whatever is deployed', async () => {
    const slugs = fc.constantFrom('a', 'b', 'c', 'd');
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(slugs),
        fc.uniqueArray(slugs),
        fc.uniqueArray(slugs),
        async (foreign, first, second) => {
          const seed = Object.fromEntries(
            foreign.map((s) => [at('skills', s, 'SKILL.md'), `foreign ${s}`]),
          );
          const { fs, svc } = setup(seed);
          for (const selection of [first, second]) {
            const items = selection.map((s) => S(s, `${s} ${selection.length}\n`));
            const plan = await svc.plan({
              items,
              selections: [{ target: T, items: items.map((i) => i.manifest.id) }],
            });
            const res = Object.fromEntries(
              plan.targets[0]!.changes.filter((c) => c.op === 'conflict').map((c) => [
                c.id,
                'skip' as const,
              ]),
            );
            await svc.apply(plan, res);
          }
          for (const [p, content] of Object.entries(seed)) expect(await text(fs, p)).toBe(content);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('line endings (T1.4.8)', () => {
  it('keeps CRLF on update, writes LF for new files, never a BOM', async () => {
    const { fs, svc, deploy } = setup();
    await deploy([S('a', 'one\ntwo\n')]);
    // Simulate an editor converting the owned file to CRLF, then accepting it as the new baseline.
    fs.putSync(at('skills', 'a', 'SKILL.md'), 'one\r\ntwo\r\n');
    const drift = await svc.plan({
      items: [S('a', 'one\ntwo\nthree\n'), S('b', 'x\ny\n')],
      selections: [{ target: T, items: ['skill.a', 'skill.b'] }],
    });
    await svc.apply(drift, { [drift.targets[0]!.changes[0]!.id]: 'overwrite' });
    expect(await text(fs, at('skills', 'a', 'SKILL.md'))).toBe('one\r\ntwo\r\nthree\r\n');
    expect(await text(fs, at('skills', 'b', 'SKILL.md'))).toBe('x\ny\n');
  });
});

describe('managed regions in shared files (T1.3.6 + deployer, S7)', () => {
  it('inserts, updates, and removes only AMC regions', async () => {
    const userFile = '# My notes\r\n\r\nKeep this.\r\n';
    const { fs, svc, deploy } = setup({ [join(SHARED, 'AGENTS.md')]: userFile });
    const cmd = (body: string) => mk('command.go', {}, body);
    await deploy([cmd('Go fast.')]);
    let file = await text(fs, join(SHARED, 'AGENTS.md'));
    expect(file.startsWith(userFile)).toBe(true);
    expect(readRegion(file, 'command.go')).toBe('Go fast.\n');
    expect(file).not.toMatch(/[^\r]\n/); // stays CRLF

    fs.putSync(join(SHARED, 'AGENTS.md'), file + 'Added later by the user.\r\n');
    await deploy([cmd('Go slow.')]);
    file = await text(fs, join(SHARED, 'AGENTS.md'));
    expect(readRegion(file, 'command.go')).toBe('Go slow.\n');
    expect(file).toContain('Added later by the user.');

    const plan = await svc.plan({ items: [], selections: [{ target: T, items: [] }] });
    expect(ops(plan)).toEqual(['delete:AGENTS.md#command.go']);
    await svc.apply(plan);
    file = await text(fs, join(SHARED, 'AGENTS.md'));
    expect(file).toBe(userFile + '\r\nAdded later by the user.\r\n');
  });
});

/** Fails the Nth write into a target folder, like a crash or power loss mid-deploy. */
class CrashingFs extends MemFs {
  armed = false;
  left = 0;
  override async writeFileAtomic(path: string, data: Buffer | string): Promise<void> {
    if (this.armed && !isState(path) && this.left-- === 0) throw new Error('simulated crash');
    return super.writeFileAtomic(path, data);
  }
}

describe('journal and crash recovery (T1.4.5, T1.4.6, S8)', () => {
  async function crashMidDeploy(crashAfter: number) {
    const fs = new CrashingFs();
    const { svc, deploy } = setup({}, fs);
    await deploy([S('a'), S('b'), S('c')]);
    const before = fs.dump();
    const plan = await svc.plan({
      items: [S('a', 'a2\n'), S('b', 'b2\n'), S('c', 'c2\n')],
      selections: [{ target: T, items: ['skill.a', 'skill.b', 'skill.c'] }],
    });
    fs.armed = true;
    fs.left = crashAfter;
    await expect(svc.apply(plan)).rejects.toThrow('simulated crash');
    fs.armed = false;
    return { fs, svc, before };
  }

  const targetFiles = (dump: Record<string, string>) =>
    Object.fromEntries(Object.entries(dump).filter(([p]) => !isState(p)));

  it.each([0, 1, 2, 3])(
    'detects an interrupted deploy (crash after %i writes) and rolls back',
    async (n) => {
      const { fs, svc, before } = await crashMidDeploy(n);
      const [j] = await svc.incomplete();
      expect(j).toMatchObject({ status: 'in-progress' });
      await svc.recover(j!.deployId, 'rollback');
      expect(targetFiles(fs.dump())).toEqual(targetFiles(before));
      expect(await svc.incomplete()).toEqual([]);
    },
  );

  it('can instead complete the interrupted deploy', async () => {
    const { fs, svc } = await crashMidDeploy(1);
    const [j] = await svc.incomplete();
    await svc.recover(j!.deployId, 'complete');
    expect(await text(fs, at('skills', 'c', 'SKILL.md'))).toBe('c2\n');
    const lock = parseLockfile(await text(fs, at(LOCKFILE)));
    expect(lock.files['skills/c/SKILL.md']!.deployId).toBe(j!.deployId);
    // Completed state is a normal state: the next plan is all unchanged.
    const next = await svc.plan({
      items: [S('a', 'a2\n'), S('b', 'b2\n'), S('c', 'c2\n')],
      selections: [{ target: T, items: ['skill.a', 'skill.b', 'skill.c'] }],
    });
    expect(ops(next).every((o) => o.startsWith('unchanged'))).toBe(true);
  });
});

describe('rollback (T1.4.7, S3)', () => {
  it('restores the previous state byte-for-byte, and a rollback can itself be rolled back', async () => {
    const { fs, svc, deploy } = setup({ [at('skills', 'x', 'SKILL.md')]: 'foreign' });
    await deploy([S('a'), S('b')]);
    const afterFirst = fs.dump();
    const { report: second } = await deploy([S('a', 'a2\n'), S('c')]);
    const afterSecond = fs.dump();

    const rb = await svc.planRollback(second.deployId);
    expect(rb.kind).toBe('rollback');
    expect(rb.targets[0]!.changes.map((c) => `${c.op}:${c.relPath}`).sort()).toEqual([
      'create:skills/b/SKILL.md',
      'delete:skills/c/SKILL.md',
      'update:skills/a/SKILL.md',
    ]);
    const undo = await svc.apply(rb);
    const strip = (d: Record<string, string>) =>
      Object.fromEntries(Object.entries(d).filter(([p]) => !isState(p)));
    expect(strip(fs.dump())).toEqual(strip(afterFirst));

    await svc.apply(await svc.planRollback(undo.deployId));
    expect(strip(fs.dump())).toEqual(strip(afterSecond));
  });

  it('refuses when a later change touched the same file', async () => {
    const { fs, svc, deploy } = setup();
    const { report } = await deploy([S('a'), S('b')]);
    await deploy([S('a', 'a2\n'), S('b')]);
    await expect(svc.planRollback(report.deployId)).rejects.toSatisfy(
      (e) => isAmcError(e, 'ROLLBACK_REFUSED') && (e.details as string[]).length === 1,
    );
    fs.putSync(at('skills', 'b', 'SKILL.md'), 'hand edit');
    await expect(svc.planRollback(report.deployId)).rejects.toSatisfy((e) =>
      isAmcError(e, 'ROLLBACK_REFUSED'),
    );
  });

  it('allows rolling back an older deploy when later ones touched other files', async () => {
    const { fs, svc, deploy } = setup();
    const { report: first } = await deploy([S('a')]);
    await deploy([S('a'), S('b')]);
    await svc.apply(await svc.planRollback(first.deployId));
    expect(await fs.stat(at('skills', 'a', 'SKILL.md'))).toBeNull();
    expect(await text(fs, at('skills', 'b', 'SKILL.md'))).toBe('b v1\n');
    expect(Object.keys(parseLockfile(await text(fs, at(LOCKFILE))).files)).toEqual([
      'skills/b/SKILL.md',
    ]);
  });

  it('prunes old snapshots but never the latest or recent ones', async () => {
    const { svc, deploy } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await deploy([S('a', `v${i}\n`)])).report.deployId);
    expect(await svc.prune({ keep: 2, maxAgeDays: 30 })).toEqual([]);
    expect(await svc.prune({ keep: 2, maxAgeDays: 0 })).toEqual([ids[2], ids[1], ids[0]]);
    expect(await svc.prune({ keep: 0, maxAgeDays: 0 })).toEqual([ids[3]]);
    expect((await svc.history()).map((m) => m.deployId)).toEqual([ids[4]]);
  });
});

describe('deploy records (T1.4.9)', () => {
  it('reports one row per item and target with its files', async () => {
    const { deploy } = setup();
    const skill = { ...S('a'), files: { 'r.md': Buffer.from('r') } };
    const { report } = await deploy([skill, mk('command.go', {}, 'Go')]);
    expect(report.records.map((r) => [r.itemId, r.itemVersion, r.targetId, r.files])).toEqual([
      ['command.go', '0.1.0', TID, ['shared:AGENTS.md']],
      ['skill.a', '0.1.0', TID, ['main:skills/a/SKILL.md', 'main:skills/a/r.md']],
    ]);
  });
});
