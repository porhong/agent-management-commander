import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { AdapterRegistry } from '../adapter/registry';
import { spliceRegion } from '../adapter/regions';
import { AmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { sha256 } from '../fs/text';
import type { AmcPaths } from '../library/bootstrap';
import { CORE_RULES } from '../validator/rules';
import { Validator } from '../validator/validator';
import {
  LOCKFILE,
  getEntry,
  parseLockfile,
  readLockfile,
  serializeLockfile,
  setEntry,
} from './lockfile';
import {
  changeId,
  conflictsOf,
  isInside,
  ordinal,
  planDeploy,
  type LockMirror,
  type PlanInput,
} from './planner';
import type {
  ConflictResolution,
  DeployPlan,
  DeployReport,
  DeploymentRecord,
  FileChange,
  Journal,
  LockEntry,
  Lockfile,
  PlannedChange,
  SnapshotEntry,
  SnapshotManifest,
  TargetPlan,
} from './types';

export interface DeployServiceOptions {
  fs: FsPort;
  paths: AmcPaths;
  adapters: AdapterRegistry;
  /** Defaults to the core rules plus every adapter's rules. */
  validator?: Validator;
  now?: () => Date;
  newId?: () => string;
  /** The index's copy of every lockfile (kept in sync after each write). */
  lockMirror?: LockMirror;
}

export type RecoveryMode = 'rollback' | 'complete';

/** A pending disk mutation, computed in full before anything is written. */
interface FileOp {
  path: string;
  targetId: string;
  root: string;
  rootDir: string;
  relPath: string;
  itemId?: string;
  /** Final bytes, or null to delete. */
  data: Buffer | null;
  /** Foreign file to move aside first (conflict resolved with `rename`). */
  backupTo?: string;
  lockfile?: boolean;
}

const resolutionWrites = (r: ConflictResolution | undefined) =>
  r === 'adopt-replace' || r === 'overwrite' || r === 'rename';

/**
 * Plans and applies deploys (M1.4), with snapshots, a journal for crash recovery, and rollback.
 * Safety invariants S1–S5 and S8 from docs/plan/engineering-practices.md §5 are enforced here.
 */
export class DeployService {
  private readonly fs: FsPort;
  private readonly paths: AmcPaths;
  private readonly adapters: AdapterRegistry;
  private readonly validator: Validator;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly lockMirror: LockMirror | undefined;

  constructor(opts: DeployServiceOptions) {
    this.fs = opts.fs;
    this.paths = opts.paths;
    this.adapters = opts.adapters;
    this.validator = opts.validator ?? new Validator([...CORE_RULES, ...opts.adapters.rules()]);
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomBytes(8).toString('hex'));
    this.lockMirror = opts.lockMirror;
  }

  private get journalDir() {
    return join(this.paths.state, 'journal');
  }

  plan(input: PlanInput): Promise<DeployPlan> {
    return planDeploy(
      {
        fs: this.fs,
        adapters: this.adapters,
        validator: this.validator,
        now: this.now,
        newId: this.newId,
        ...(this.lockMirror && { lockMirror: this.lockMirror }),
      },
      input,
    );
  }

  // ---------- apply (T1.4.5) ----------

  async apply(
    plan: DeployPlan,
    resolutions: Record<string, ConflictResolution> = {},
  ): Promise<DeployReport> {
    const blocking = plan.issues.filter((i) => i.blocking);
    if (blocking.length) {
      throw new AmcError(
        'PLAN_BLOCKED',
        `${blocking.length} blocking issue(s): ${blocking[0]!.message}`,
        blocking,
      );
    }
    const unresolved = conflictsOf(plan).filter((c) => !c.options.includes(resolutions[c.id]!));
    if (unresolved.length) {
      throw new AmcError(
        'CONFLICTS_UNRESOLVED',
        `${unresolved.length} conflict(s) need a decision: ${unresolved.map((c) => c.relPath).join(', ')}`,
        unresolved.map((c) => c.id),
      );
    }

    // S5: the disk must look exactly as it did when the plan was made.
    const stale: string[] = [];
    for (const [path, hash] of Object.entries(plan.readHashes)) {
      if ((await this.hashOf(path)) !== hash) stale.push(path);
    }
    if (stale.length)
      throw new AmcError(
        'PLAN_STALE',
        `Files changed since the plan was made: ${stale.join(', ')}`,
        stale,
      );

    const deployId = this.deployId();
    const stampedAt = this.now().toISOString();
    const { ops, skipped, records, lockChanges } = await this.buildOps(
      plan,
      resolutions,
      deployId,
      stampedAt,
    );

    // S4: every path, after resolving links, stays inside its root. Checked before any write.
    for (const op of ops) {
      const realRoot = await this.fs.realpath(op.rootDir);
      for (const p of [op.path, op.backupTo].filter((x): x is string => !!x)) {
        if (!isInside(realRoot, await this.fs.realpath(p))) {
          throw new AmcError('PATH_OUTSIDE_ROOT', `Refusing to write outside ${op.rootDir}: ${p}`);
        }
      }
    }

    const report: DeployReport = {
      deployId,
      planId: plan.planId,
      written: [],
      deleted: [],
      skipped,
      records,
    };
    if (ops.length === 0) return report;

    // S8: journal first, then S2: snapshot every affected path, then write.
    await this.writeJournal({
      deployId,
      planId: plan.planId,
      startedAt: stampedAt,
      status: 'in-progress',
    });
    await this.snapshot(deployId, plan, ops, lockChanges, stampedAt);

    for (const op of ops.filter((o) => o.backupTo)) await this.fs.rename(op.path, op.backupTo!);
    // Lockfiles are written last, so a crash never records ownership of an unwritten file.
    for (const op of [...ops.filter((o) => !o.lockfile), ...ops.filter((o) => o.lockfile)]) {
      if (op.data) {
        await this.fs.writeFileAtomic(op.path, op.data);
        if (op.lockfile) this.lockMirror?.set(op.rootDir, parseLockfile(op.data.toString('utf8')));
        if (!op.lockfile) report.written.push(op.path);
      } else {
        await this.fs.rm(op.path);
        await this.pruneEmptyDirs(dirname(op.path), op.rootDir);
        report.deleted.push(op.path);
      }
    }

    await this.writeJournal({
      deployId,
      planId: plan.planId,
      startedAt: stampedAt,
      status: 'complete',
      completedAt: this.now().toISOString(),
    });
    return report;
  }

  /** Turns plan changes into concrete file operations, including new lockfiles. */
  private async buildOps(
    plan: DeployPlan,
    resolutions: Record<string, ConflictResolution>,
    deployId: string,
    stampedAt: string,
  ) {
    const ops: FileOp[] = [];
    const skipped: string[] = [];
    const recordMap = new Map<string, DeploymentRecord>();
    const lockChanges: SnapshotManifest['locks'] = [];

    for (const tp of plan.targets) {
      if (tp.status !== 'ok') continue;
      const locks: Record<string, { lock: Lockfile; original: string | null }> = {};
      const lockOf = async (root: string) => {
        if (!locks[root]) {
          const read = await readLockfile(this.fs, tp.roots[root]!);
          locks[root] = {
            lock: read.lock,
            original: read.hash === null ? null : serializeLockfile(read.lock),
          };
        }
        return locks[root]!;
      };
      const setLock = async (
        root: string,
        relPath: string,
        region: string | undefined,
        entry: LockEntry | null,
      ) => {
        const l = await lockOf(root);
        const before = getEntry(l.lock, relPath, region) ?? null;
        l.lock = setEntry(l.lock, relPath, region, entry);
        lockChanges.push({
          targetId: tp.targetId,
          root,
          relPath,
          ...(region && { region }),
          before,
          after: entry,
        });
      };

      // Group by file: several regions may land in one shared file.
      const byFile = new Map<string, PlannedChange[]>();
      for (const c of tp.changes) {
        const key = `${c.root}|${c.relPath}`;
        byFile.set(key, [...(byFile.get(key) ?? []), c]);
      }

      for (const changes of byFile.values()) {
        const { root, relPath } = changes[0]!;
        const rootDir = tp.roots[root]!;
        const path = join(rootDir, ...relPath.split('/'));
        let data: Buffer | null | undefined; // undefined = no disk change
        let backupTo: string | undefined;
        let text: string | undefined;

        for (const c of changes) {
          const effective = this.effectiveOp(c, resolutions[c.id]);
          if (effective === 'skip') {
            skipped.push(`${tp.targetId}:${relPath}${c.region ? `#${c.region}` : ''}`);
            continue;
          }
          if (c.op === 'conflict' && resolutions[c.id] === 'rename')
            backupTo = await this.backupPath(path);

          if (c.region) {
            if (effective !== 'unchanged') {
              text ??= (await this.fs.stat(path))
                ? (await this.fs.readFile(path)).toString('utf8')
                : '';
              text = spliceRegion(text, c.region, effective === 'delete' ? null : String(c.after));
              data = Buffer.from(text);
            }
          } else if (effective === 'delete') {
            data = (await this.fs.stat(path)) ? null : undefined;
          } else if (effective !== 'unchanged') {
            data = Buffer.from(c.after!);
          }

          if (c.lock !== undefined) {
            const current = getEntry((await lockOf(root)).lock, relPath, c.region) ?? null;
            // Unchanged ownership keeps its old stamp, so re-deploys don't churn the lockfile.
            if (JSON.stringify(c.lock) !== JSON.stringify(current)) {
              const stamped = c.lock && { ...c.lock, deployedAt: stampedAt, deployId };
              await setLock(root, relPath, c.region, stamped);
            }
          }
          if (plan.kind === 'deploy' && effective !== 'delete') {
            const key = `${c.itemId}|${tp.targetId}`;
            const rec = recordMap.get(key) ?? {
              deployId,
              itemId: c.itemId,
              itemVersion: c.lock?.itemVersion ?? '',
              targetId: tp.targetId,
              files: [],
              deployedAt: stampedAt,
            };
            rec.files.push(`${root}:${relPath}`);
            recordMap.set(key, rec);
          }
        }
        if (data !== undefined) {
          const itemId = changes[0]!.itemId;
          ops.push({
            path,
            targetId: tp.targetId,
            root,
            rootDir,
            relPath,
            itemId,
            data,
            ...(backupTo && { backupTo }),
          });
        }
      }

      for (const u of tp.lockUpdates ?? []) await setLock(u.root, u.relPath, u.region, u.entry);

      for (const [root, l] of Object.entries(locks)) {
        const next = serializeLockfile(l.lock);
        if (next === l.original) continue;
        const empty =
          Object.keys(l.lock.files).length === 0 && Object.keys(l.lock.regions).length === 0;
        const rootDir = tp.roots[root]!;
        ops.push({
          path: join(rootDir, LOCKFILE),
          targetId: tp.targetId,
          root,
          rootDir,
          relPath: LOCKFILE,
          data: empty && l.original === null ? null : Buffer.from(next),
          lockfile: true,
        });
      }
    }
    return {
      ops: ops.filter((o) => !(o.lockfile && o.data === null)),
      skipped,
      records: [...recordMap.values()].sort(
        (a, b) => ordinal(a.itemId, b.itemId) || ordinal(a.targetId, b.targetId),
      ),
      lockChanges,
    };
  }

  private effectiveOp(
    c: PlannedChange,
    r: ConflictResolution | undefined,
  ): FileChange['op'] | 'skip' {
    if (c.op !== 'conflict') return c.op;
    return resolutionWrites(r) ? c.pending : 'skip';
  }

  private async backupPath(path: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = `${path}.amc-backup${n === 1 ? '' : `-${n}`}`;
      if (!(await this.fs.stat(candidate))) return candidate;
    }
  }

  /** Removes directories left empty by deletes, never the root itself or anything above it. */
  private async pruneEmptyDirs(dir: string, rootDir: string): Promise<void> {
    let d = dir;
    while (isInside(rootDir, d) && d !== rootDir) {
      const st = await this.fs.stat(d);
      if (st?.kind !== 'dir' || (await this.fs.readdir(d)).length > 0) return;
      await this.fs.rm(d);
      d = dirname(d);
    }
  }

  // ---------- journal & snapshots (T1.4.6, T1.4.7) ----------

  private deployId(): string {
    const ts = this.now().toISOString().replace(/[-:.]/g, '');
    return `${ts}-${this.newId().slice(0, 6)}`;
  }

  private async writeJournal(j: Journal): Promise<void> {
    await this.fs.writeFileAtomic(
      join(this.journalDir, `${j.deployId}.json`),
      JSON.stringify(j, null, 2) + '\n',
    );
  }

  private snapshotDir(deployId: string): string {
    return join(this.paths.snapshots, deployId);
  }

  private async snapshot(
    deployId: string,
    plan: DeployPlan,
    ops: FileOp[],
    locks: SnapshotManifest['locks'],
    createdAt: string,
  ): Promise<void> {
    const dir = this.snapshotDir(deployId);
    const entries: SnapshotEntry[] = [];
    let n = 0;
    for (const op of ops) {
      const id = String(n++).padStart(4, '0');
      const entry: SnapshotEntry = {
        path: op.path,
        targetId: op.targetId,
        root: op.root,
        relPath: op.relPath,
        ...(op.itemId && { itemId: op.itemId }),
        existed: false,
      };
      if (await this.fs.stat(op.path)) {
        const before = await this.fs.readFile(op.path);
        await this.fs.writeFileAtomic(join(dir, 'before', id), before);
        Object.assign(entry, { existed: true, beforeFile: id, beforeSha: sha256(before) });
      }
      if (op.data) {
        await this.fs.writeFileAtomic(join(dir, 'after', id), op.data);
        Object.assign(entry, { afterFile: id, afterSha: sha256(op.data) });
      }
      entries.push(entry);
    }
    const manifest: SnapshotManifest = {
      deployId,
      planId: plan.planId,
      kind: plan.kind,
      ...(plan.revertsDeployId && { revertsDeployId: plan.revertsDeployId }),
      createdAt,
      entries,
      locks,
    };
    await this.fs.writeFileAtomic(
      join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }

  async readManifest(deployId: string): Promise<SnapshotManifest> {
    const path = join(this.snapshotDir(deployId), 'manifest.json');
    if (!(await this.fs.stat(path)))
      throw new AmcError('DEPLOY_NOT_FOUND', `No snapshot for deploy ${deployId}`);
    return JSON.parse((await this.fs.readFile(path)).toString('utf8')) as SnapshotManifest;
  }

  /** Deploys that have snapshots, newest first. */
  async history(): Promise<SnapshotManifest[]> {
    if (!(await this.fs.stat(this.paths.snapshots))) return [];
    const out: SnapshotManifest[] = [];
    for (const e of await this.fs.readdir(this.paths.snapshots)) {
      if (e.kind !== 'dir') continue;
      try {
        out.push(await this.readManifest(e.path));
      } catch {
        // A snapshot folder without a manifest belongs to a deploy that never wrote anything.
      }
    }
    return out.sort((a, b) => ordinal(b.deployId, a.deployId));
  }

  // ---------- rollback (T1.4.7) ----------

  /**
   * A plan that restores what `deployId` changed. It goes through apply like any deploy, so it is
   * snapshotted and can itself be rolled back. Refused if a later change touched the same files (S3).
   */
  async planRollback(deployId: string): Promise<DeployPlan> {
    const m = await this.readManifest(deployId);
    const readHashes: Record<string, string | null> = {};
    const touched: string[] = [];
    const targets = new Map<string, TargetPlan>();

    for (const e of m.entries) {
      const current = (await this.fs.stat(e.path)) ? await this.fs.readFile(e.path) : null;
      const currentSha = current && sha256(current);
      readHashes[e.path] = currentSha;
      // Ownership is restored entry by entry below, so later edits to the lockfile are fine.
      if (e.relPath === LOCKFILE) continue;
      if (currentSha !== (e.afterSha ?? null)) touched.push(e.path);

      const tp = this.rollbackTarget(targets, e.targetId, e.root, dirname(e.path), e.relPath);
      const before = e.existed
        ? await this.fs.readFile(join(this.snapshotDir(deployId), 'before', e.beforeFile!))
        : null;
      const op: FileChange['op'] = !e.existed ? 'delete' : current ? 'update' : 'create';
      tp.changes.push({
        id: changeId(e.targetId, e.root, e.relPath),
        op,
        targetId: e.targetId,
        root: e.root,
        relPath: e.relPath,
        itemId: e.itemId ?? '',
        before: current,
        after: before,
        adaptations: [],
      });
    }
    if (touched.length) {
      throw new AmcError(
        'ROLLBACK_REFUSED',
        `Can't roll back ${deployId}: ${touched.length} file(s) changed after it (${touched.join(', ')})`,
        touched,
      );
    }
    for (const l of m.locks) {
      const lockPath = m.entries.find(
        (e) => e.root === l.root && e.targetId === l.targetId && e.relPath === LOCKFILE,
      );
      const rootDir = lockPath ? dirname(lockPath.path) : undefined;
      const tp =
        targets.get(l.targetId) ??
        (rootDir ? this.rollbackTarget(targets, l.targetId, l.root, rootDir, LOCKFILE) : undefined);
      if (!tp) continue;
      if (rootDir) tp.roots[l.root] = rootDir;
      tp.lockUpdates!.push({
        root: l.root,
        relPath: l.relPath,
        ...(l.region && { region: l.region }),
        entry: l.before,
      });
    }
    return {
      planId: this.newId(),
      kind: 'rollback',
      revertsDeployId: deployId,
      createdAt: this.now().toISOString(),
      targets: [...targets.values()],
      readHashes,
      issues: [],
    };
  }

  private rollbackTarget(
    targets: Map<string, TargetPlan>,
    targetId: string,
    root: string,
    fileDir: string,
    relPath: string,
  ): TargetPlan {
    let tp = targets.get(targetId);
    if (!tp) {
      const [toolId, scope, ...rest] = targetId.split(':');
      tp = {
        target:
          scope === 'global'
            ? { toolId: toolId!, scope: 'global' }
            : { toolId: toolId!, scope: 'project', root: rest.join(':') },
        targetId,
        roots: {},
        status: 'ok',
        changes: [],
        lockUpdates: [],
      };
      targets.set(targetId, tp);
    }
    // Root folder = the file's folder minus the relPath's own folders.
    const depth = relPath.split('/').length - 1;
    let rootDir = fileDir;
    for (let i = 0; i < depth; i++) rootDir = dirname(rootDir);
    tp.roots[root] ??= rootDir;
    return tp;
  }

  // ---------- crash recovery (S8) ----------

  /** Deploys whose journal says they never finished. */
  async incomplete(): Promise<Journal[]> {
    if (!(await this.fs.stat(this.journalDir))) return [];
    const out: Journal[] = [];
    for (const e of await this.fs.readdir(this.journalDir)) {
      if (e.kind !== 'file' || !e.path.endsWith('.json')) continue;
      const j = JSON.parse(
        (await this.fs.readFile(join(this.journalDir, e.path))).toString('utf8'),
      ) as Journal;
      if (j.status === 'in-progress') out.push(j);
    }
    return out.sort((a, b) => ordinal(a.deployId, b.deployId));
  }

  /**
   * Finishes an interrupted deploy: `rollback` restores every path to its pre-deploy bytes,
   * `complete` writes every path's post-deploy bytes. Both are idempotent.
   */
  async recover(deployId: string, mode: RecoveryMode): Promise<void> {
    const jPath = join(this.journalDir, `${deployId}.json`);
    if (!(await this.fs.stat(jPath)))
      throw new AmcError('DEPLOY_NOT_FOUND', `No journal for ${deployId}`);
    const journal = JSON.parse((await this.fs.readFile(jPath)).toString('utf8')) as Journal;
    let manifest: SnapshotManifest | undefined;
    try {
      manifest = await this.readManifest(deployId);
    } catch {
      // Crashed before the snapshot was complete: no target file was written yet.
    }
    const dir = this.snapshotDir(deployId);
    for (const e of manifest?.entries ?? []) {
      const source =
        mode === 'rollback'
          ? e.existed
            ? join(dir, 'before', e.beforeFile!)
            : null
          : e.afterFile
            ? join(dir, 'after', e.afterFile)
            : null;
      if (source) await this.fs.writeFileAtomic(e.path, await this.fs.readFile(source));
      else await this.fs.rm(e.path);
      if (e.relPath === LOCKFILE) await this.syncMirror(dirname(e.path));
    }
    await this.writeJournal({
      ...journal,
      status: manifest && mode === 'complete' ? 'complete' : 'rolled-back',
      completedAt: this.now().toISOString(),
    });
  }

  // ---------- lockfile mirror (T1.4.1) ----------

  private async syncMirror(rootDir: string): Promise<void> {
    if (!this.lockMirror) return;
    const read = await readLockfile(this.fs, rootDir);
    this.lockMirror.set(rootDir, read.hash === null ? null : read.lock);
  }

  /** Writes the index's copy back after the lockfile was deleted. Never touches other files. */
  async restoreLockfile(rootDir: string): Promise<void> {
    const lock = this.lockMirror?.get(rootDir);
    if (!lock) throw new AmcError('DEPLOY_NOT_FOUND', `The index has no lockfile for ${rootDir}`);
    await this.fs.writeFileAtomic(join(rootDir, LOCKFILE), serializeLockfile(lock));
  }

  /** Accepts the loss: AMC no longer owns anything in that root (its files become foreign). */
  forgetLockfile(rootDir: string): void {
    this.lockMirror?.set(rootDir, null);
  }

  // ---------- pruning ----------

  /**
   * Deletes snapshots that are beyond the newest `keep` deploys **and** older than `maxAgeDays`.
   * The latest snapshot and those of unfinished deploys are always kept.
   */
  async prune(opts: { keep?: number; maxAgeDays?: number } = {}): Promise<string[]> {
    const keep = opts.keep ?? 50;
    const cutoff = this.now().getTime() - (opts.maxAgeDays ?? 30) * 86_400_000;
    const unfinished = new Set((await this.incomplete()).map((j) => j.deployId));
    const all = await this.history();
    const removed: string[] = [];
    for (const [i, m] of all.entries()) {
      if (i === 0 || i < keep || unfinished.has(m.deployId)) continue;
      if (Date.parse(m.createdAt) >= cutoff) continue;
      await this.fs.rm(this.snapshotDir(m.deployId), { recursive: true });
      removed.push(m.deployId);
    }
    return removed;
  }

  private async hashOf(path: string): Promise<string | null> {
    const st = await this.fs.stat(path);
    return st?.kind === 'file' ? sha256(await this.fs.readFile(path)) : null;
  }
}
