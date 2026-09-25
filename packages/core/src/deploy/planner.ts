import { isAbsolute, relative } from 'node:path';
import type { AdapterRegistry } from '../adapter/registry';
import { readRegion } from '../adapter/regions';
import { targetId, type CompiledFile, type Target } from '../adapter/types';
import { AmcError, isAmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { detectEol, safeJoin, sha256, toLf, withEol } from '../fs/text';
import type { LibraryItem } from '../library/item-io';
import type { LoadProblem } from '../library/service';
import type { ItemId } from '../model/common';
import { resolveClosure, type ResolvedItem } from '../resolver/closure';
import { buildGraph } from '../resolver/graph';
import { looksBinary } from '../validator/secrets';
import type { Issue } from '../validator/types';
import type { Validator } from '../validator/validator';
import { entriesFor, getEntry, readLockfile } from './lockfile';
import type {
  ConflictChange,
  Content,
  DeployPlan,
  FileChange,
  LockEntry,
  Lockfile,
  PlannedChange,
  TargetPlan,
  TargetSelection,
} from './types';

export interface PlannerDeps {
  fs: FsPort;
  adapters: AdapterRegistry;
  validator: Validator;
  now: () => Date;
  newId: () => string;
  lockMirror?: LockMirror;
}

/** The index's copy of each lockfile, used to notice (and recover) a deleted lockfile. */
export interface LockMirror {
  get(rootDir: string): Lockfile | undefined;
  set(rootDir: string, lock: Lockfile | null): void;
}

const ownedCount = (lock: Lockfile | undefined): number =>
  lock
    ? Object.keys(lock.files).length +
      Object.values(lock.regions).reduce((n, r) => n + Object.keys(r).length, 0)
    : 0;

export interface PlanInput {
  items: readonly LibraryItem[];
  problems?: readonly LoadProblem[];
  selections: readonly TargetSelection[];
}

/** True when `child` is `parent` or inside it. Both must already be normalized. */
export const isInside = (parent: string, child: string): boolean => {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

/** Locale-independent ordering, so plans are identical on every machine. */
export const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const changeId = (targetId: string, root: string, relPath: string, region?: string) =>
  `${targetId}|${root}|${relPath}${region ? `#${region}` : ''}`;

/** Text stays a string (for diffs), binary stays a Buffer. */
const asContent = (bytes: Buffer): Content => (looksBinary(bytes) ? bytes : bytes.toString('utf8'));

/** Region inner text as stored in the file: LF, ending with exactly one newline. */
const normalizeRegion = (text: string) => toLf(text).replace(/\n*$/, '\n');

const planIssue = (ruleId: string, message: string, extra: Partial<Issue> = {}): Issue => ({
  ruleId,
  severity: 'error',
  blocking: true,
  message,
  ...extra,
});

/**
 * Computes what a deploy would do (T1.4.2). Reads only: target files and lockfiles. The result is
 * deterministic for a given disk state and records the hash of everything it read, so `apply`
 * can refuse a stale plan (S5).
 */
export async function planDeploy(deps: PlannerDeps, input: PlanInput): Promise<DeployPlan> {
  const { fs } = deps;
  const readHashes: Record<string, string | null> = {};
  const issues: Issue[] = [];
  const graph = buildGraph(input.items);
  const now = deps.now().toISOString();

  const readCurrent = async (abs: string): Promise<Buffer | null> => {
    const st = await fs.stat(abs);
    const bytes = st?.kind === 'file' ? await fs.readFile(abs) : null;
    readHashes[abs] = bytes ? sha256(bytes) : null;
    return bytes;
  };

  const targets: TargetPlan[] = [];
  const allIds = new Set<ItemId>();

  for (const sel of input.selections) {
    assertTarget(sel.target);
    const adapter = deps.adapters.get(sel.target.toolId);
    const tid = targetId(sel.target);
    const roots = adapter.paths(sel.target);
    const tp: TargetPlan = { target: sel.target, targetId: tid, roots, status: 'ok', changes: [] };
    targets.push(tp);

    // 1. Lockfiles. A corrupt one puts the whole target on hold: no writes at all.
    const locks: Record<string, Lockfile> = {};
    try {
      for (const [key, dir] of Object.entries(roots)) {
        const read = await readLockfile(fs, dir);
        locks[key] = read.lock;
        readHashes[read.path] = read.hash;
        // A missing lockfile the index remembers means AMC would forget what it owns (T1.4.1).
        const remembered = ownedCount(deps.lockMirror?.get(dir));
        if (read.hash === null && remembered > 0) {
          throw new AmcError(
            'LOCK_CORRUPT',
            `${read.path} is missing, but AMC's index remembers ${remembered} owned file(s) there. Restore the lockfile or forget them.`,
            { rootDir: dir, reason: 'missing' },
          );
        }
      }
    } catch (err) {
      if (!isAmcError(err, 'LOCK_CORRUPT')) throw err;
      tp.status = 'needs-attention';
      tp.message = err.message;
      issues.push({ ...planIssue('lockfile', err.message, { targetId: tid }), blocking: false });
      continue;
    }

    // 2. Resolve. A broken selection must not turn into "delete everything that's deployed".
    let resolved: ResolvedItem[];
    try {
      resolved = resolveClosure(graph, sel.items);
    } catch (err) {
      if (!isAmcError(err)) throw err;
      tp.status = 'needs-attention';
      tp.message = err.message;
      issues.push(planIssue('resolve', err.message, { targetId: tid }));
      continue;
    }
    for (const r of resolved) allIds.add(r.item.manifest.id);

    // 3. Compile.
    const desired = new Map<string, { file: CompiledFile; version: string }>();
    for (const r of resolved) {
      if (r.item.manifest.compat?.exclude.includes(sel.target.toolId)) continue;
      for (const file of adapter.compile(r, sel.target)) {
        const id = changeId(tid, file.root, file.relPath, file.region);
        const clash = desired.get(id);
        if (clash) {
          issues.push(
            planIssue(
              'path-collision',
              `${file.relPath} is produced by both ${clash.file.itemId} and ${file.itemId}`,
              { itemId: file.itemId, targetId: tid },
            ),
          );
          continue;
        }
        desired.set(id, { file, version: r.item.manifest.version });
      }
    }

    // 4. Diff desired files against disk + lockfile.
    for (const [id, { file, version }] of desired) {
      const rootDir = roots[file.root];
      if (!rootDir) throw new Error(`${adapter.id} compiled into unknown root "${file.root}"`);
      let abs: string;
      try {
        abs = safeJoin(rootDir, file.relPath);
      } catch (err) {
        issues.push(
          planIssue('path-safety', (err as Error).message, { itemId: file.itemId, targetId: tid }),
        );
        continue;
      }
      const lock = locks[file.root]!;
      const entry = getEntry(lock, file.relPath, file.region);
      const current = await readCurrent(abs);
      const base = {
        id,
        targetId: tid,
        root: file.root,
        relPath: file.relPath,
        ...(file.region && { region: file.region }),
        itemId: file.itemId,
        adaptations: file.adaptations,
      };
      const lockFor = (sha: string): LockEntry =>
        entry &&
        entry.sha256 === sha &&
        entry.itemVersion === version &&
        entry.itemId === file.itemId
          ? entry
          : {
              itemId: file.itemId,
              itemVersion: version,
              targetId: tid,
              sha256: sha,
              deployedAt: now,
            };

      // A path that resolves outside its root (symlink/junction) is never written (S4).
      const [realRoot, realPath] = [await fs.realpath(rootDir), await fs.realpath(abs)];
      if (!isInside(realRoot, realPath)) {
        tp.changes.push(
          conflict(base, 'linked', 'update', current && asContent(current), null, ['skip']),
        );
        continue;
      }

      if (file.region) {
        const after = normalizeRegion(String(file.content));
        let before: string | null;
        try {
          before = current ? readRegion(current.toString('utf8'), file.region) : null;
        } catch (err) {
          issues.push(
            planIssue('region', (err as Error).message, { itemId: file.itemId, targetId: tid }),
          );
          continue;
        }
        const lockEntry = lockFor(sha256(after));
        if (before === after) {
          tp.changes.push(fileChange(base, 'unchanged', before, after, lockEntry, !entry));
        } else if (before !== null && !entry) {
          tp.changes.push(
            conflict(
              base,
              'foreign',
              'update',
              before,
              after,
              ['adopt-replace', 'skip'],
              lockEntry,
            ),
          );
        } else if (before !== null && entry && sha256(before) !== entry.sha256) {
          tp.changes.push(
            conflict(base, 'drifted', 'update', before, after, ['overwrite', 'skip'], lockEntry),
          );
        } else {
          tp.changes.push(
            fileChange(base, before === null ? 'create' : 'update', before, after, lockEntry),
          );
        }
        continue;
      }

      // Whole file. Text keeps the existing file's line endings (T1.4.8); new files get LF.
      const text = typeof file.content === 'string';
      const eol =
        current && text && !looksBinary(current) ? detectEol(current.toString('utf8')) : '\n';
      const afterBytes = text
        ? Buffer.from(withEol(file.content as string, eol))
        : Buffer.from(file.content);
      const after = text ? afterBytes.toString('utf8') : afterBytes;
      const lockEntry = lockFor(sha256(afterBytes));
      if (!current) {
        tp.changes.push(fileChange(base, 'create', null, after, lockEntry));
      } else if (current.equals(afterBytes)) {
        tp.changes.push(
          fileChange(base, 'unchanged', asContent(current), after, lockEntry, !entry),
        );
      } else if (!entry) {
        tp.changes.push(
          conflict(
            base,
            'foreign',
            'update',
            asContent(current),
            after,
            ['adopt-replace', 'rename', 'skip'],
            lockEntry,
          ),
        );
      } else if (sha256(current) !== entry.sha256) {
        tp.changes.push(
          conflict(
            base,
            'drifted',
            'update',
            asContent(current),
            after,
            ['overwrite', 'skip'],
            lockEntry,
          ),
        );
      } else {
        tp.changes.push(fileChange(base, 'update', asContent(current), after, lockEntry));
      }
    }

    // 5. Deletes (T1.4.3): owned by this target, no longer produced. Foreign files never appear.
    for (const [key, lock] of Object.entries(locks)) {
      const rootDir = roots[key]!;
      for (const [relPath, region, entry] of entriesFor(lock, tid)) {
        const id = changeId(tid, key, relPath, region);
        if (desired.has(id)) continue;
        const abs = safeJoin(rootDir, relPath);
        const current = await readCurrent(abs);
        const base = {
          id,
          targetId: tid,
          root: key,
          relPath,
          ...(region && { region }),
          itemId: entry.itemId,
          adaptations: [],
        };
        let before: Content | null = current && asContent(current);
        let beforeSha = current && sha256(current);
        if (region) {
          let inner: string | null;
          try {
            inner = current ? readRegion(current.toString('utf8'), region) : null;
          } catch (err) {
            issues.push(
              planIssue('region', (err as Error).message, { itemId: entry.itemId, targetId: tid }),
            );
            continue;
          }
          before = inner;
          beforeSha = inner === null ? null : sha256(inner);
        }
        if (before !== null && beforeSha !== entry.sha256) {
          tp.changes.push(
            conflict(base, 'drifted', 'delete', before, null, ['overwrite', 'skip'], null),
          );
        } else {
          // Already gone: nothing to delete on disk, just forget it.
          tp.changes.push(fileChange(base, 'delete', before, null, null));
        }
      }
    }

    tp.changes.sort((a, b) => ordinal(a.id, b.id));
  }

  const validated = deps.validator.validate({
    items: input.items,
    problems: input.problems,
    targets: input.selections.map((s) => ({ id: targetId(s.target), toolId: s.target.toolId })),
    only: allIds,
  });

  return {
    planId: deps.newId(),
    kind: 'deploy',
    createdAt: now,
    targets,
    readHashes,
    issues: [...issues, ...validated],
  };
}

function fileChange(
  base: Omit<FileChange, 'op' | 'before' | 'after' | 'lock'>,
  op: FileChange['op'],
  before: Content | null,
  after: Content | null,
  lock: LockEntry | null,
  adopt = false,
): FileChange {
  return { ...base, op, before, after, lock, ...(adopt && op === 'unchanged' && { adopt }) };
}

function conflict(
  base: Omit<ConflictChange, 'op' | 'reason' | 'pending' | 'options' | 'before' | 'after' | 'lock'>,
  reason: ConflictChange['reason'],
  pending: ConflictChange['pending'],
  before: Content | null,
  after: Content | null,
  options: ConflictChange['options'],
  lock: LockEntry | null = null,
): PlannedChange {
  return { ...base, op: 'conflict', reason, pending, options, before, after, lock };
}

export const conflictsOf = (plan: DeployPlan): ConflictChange[] =>
  plan.targets.flatMap((t) => t.changes.filter((c): c is ConflictChange => c.op === 'conflict'));

export const assertTarget = (t: Target): Target => {
  if (t.scope === 'project' && !isAbsolute(t.root)) {
    throw new AmcError('PATH_OUTSIDE_ROOT', `Project root must be absolute: ${t.root}`);
  }
  return t;
};
