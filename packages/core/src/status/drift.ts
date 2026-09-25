import { readRegion } from '../adapter/regions';
import type { AdapterRegistry } from '../adapter/registry';
import { targetId, type Target } from '../adapter/types';
import { entriesFor, readLockfile } from '../deploy/lockfile';
import { isAmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { safeJoin, sha256 } from '../fs/text';

/** What happened to a file AMC owns, since the deploy that last wrote it. */
export type DriftState = 'in-sync' | 'drifted' | 'missing';

export interface DriftEntry {
  targetId: string;
  /** Root key within the target, and the folder it resolves to. */
  root: string;
  rootDir: string;
  relPath: string;
  region?: string;
  itemId: string;
  state: DriftState;
}

export interface DriftReport {
  entries: DriftEntry[];
  /** Targets whose lockfile could not be read; their files are simply not reported on. */
  warnings: string[];
  checkedAt: string;
}

export interface DriftDeps {
  fs: FsPort;
  adapters: AdapterRegistry;
  now?: () => Date;
}

/**
 * Compares every file AMC owns against the hash recorded when it was deployed (T1.9.3).
 *
 * Read-only, and deliberately narrow: only paths in a lockfile are looked at, so an edit AMC
 * does not own is invisible here (that is what Import is for). A full watcher arrives in
 * Phase 2; this is cheap enough to run on window focus.
 */
export async function checkDrift(
  deps: DriftDeps,
  targets: readonly Target[],
): Promise<DriftReport> {
  const entries: DriftEntry[] = [];
  const warnings: string[] = [];
  /** One read per file, however many owned regions it holds. */
  const cache = new Map<string, Buffer | null>();

  const read = async (path: string): Promise<Buffer | null> => {
    if (cache.has(path)) return cache.get(path)!;
    const stat = await deps.fs.stat(path);
    const bytes = stat?.kind === 'file' ? await deps.fs.readFile(path) : null;
    cache.set(path, bytes);
    return bytes;
  };

  for (const target of targets) {
    const tid = targetId(target);
    let roots;
    try {
      roots = deps.adapters.get(target.toolId).paths(target);
    } catch {
      warnings.push(`No adapter for ${target.toolId}.`);
      continue;
    }

    for (const [root, rootDir] of Object.entries(roots)) {
      let lock;
      try {
        lock = (await readLockfile(deps.fs, rootDir)).lock;
      } catch (err) {
        warnings.push(isAmcError(err) ? err.message : `${rootDir}: ${(err as Error).message}`);
        continue;
      }

      for (const [relPath, region, entry] of entriesFor(lock, tid)) {
        const base = {
          targetId: tid,
          root,
          rootDir,
          relPath,
          ...(region && { region }),
          itemId: entry.itemId,
        };
        let path: string;
        try {
          path = safeJoin(rootDir, relPath);
        } catch {
          // A lockfile path that escapes its root is never followed; treat it as gone.
          entries.push({ ...base, state: 'missing' });
          continue;
        }
        const bytes = await read(path);
        if (bytes === null) {
          entries.push({ ...base, state: 'missing' });
          continue;
        }
        let actual: string;
        if (region) {
          let inner: string | null;
          try {
            inner = readRegion(bytes.toString('utf8'), region);
          } catch {
            inner = null;
          }
          if (inner === null) {
            entries.push({ ...base, state: 'missing' });
            continue;
          }
          actual = sha256(inner);
        } else {
          actual = sha256(bytes);
        }
        entries.push({ ...base, state: actual === entry.sha256 ? 'in-sync' : 'drifted' });
      }
    }
  }

  entries.sort((a, b) =>
    `${a.targetId}|${a.relPath}|${a.region ?? ''}` < `${b.targetId}|${b.relPath}|${b.region ?? ''}`
      ? -1
      : 1,
  );
  return { entries, warnings, checkedAt: (deps.now?.() ?? new Date()).toISOString() };
}
