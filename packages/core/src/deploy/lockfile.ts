import { join } from 'node:path';
import { z } from 'zod';
import { AmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { sha256, stripBom } from '../fs/text';
import { itemIdSchema } from '../model/common';
import type { LockEntry, Lockfile } from './types';

export const LOCKFILE = '.amc-lock.json';
export const AMC_VERSION = '0.1.0';

const entrySchema = z.object({
  itemId: itemIdSchema,
  itemVersion: z.string(),
  targetId: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  deployedAt: z.string(),
  deployId: z.string().optional(),
});

const v1Schema = z.object({
  schemaVersion: z.literal(1),
  amcVersion: z.string(),
  files: z.record(z.string(), entrySchema),
  regions: z.record(z.string(), z.record(z.string(), entrySchema)).default({}),
});

/** The pre-release layout from docs/concept/03 §5: one `target` per file, no schema version. */
const v0Schema = z.object({
  amcVersion: z.string(),
  target: z.string().min(1),
  files: z.record(z.string(), entrySchema.omit({ targetId: true })),
});

export const emptyLockfile = (): Lockfile => ({
  schemaVersion: 1,
  amcVersion: AMC_VERSION,
  files: {},
  regions: {},
});

/** Parses and migrates lockfile text. Throws LOCK_CORRUPT; callers must then write nothing. */
export function parseLockfile(text: string, source = LOCKFILE): Lockfile {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (err) {
    throw new AmcError('LOCK_CORRUPT', `${source}: not valid JSON (${(err as Error).message})`);
  }
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === undefined) {
    const v0 = v0Schema.safeParse(raw);
    if (!v0.success) throw corrupt(source, v0.error);
    const files: Record<string, LockEntry> = {};
    for (const [rel, e] of Object.entries(v0.data.files))
      files[rel] = { ...e, targetId: v0.data.target };
    return { schemaVersion: 1, amcVersion: v0.data.amcVersion, files, regions: {} };
  }
  if (version !== 1) {
    throw new AmcError(
      'LOCK_CORRUPT',
      `${source}: schema version ${String(version)} is newer than this AMC understands`,
    );
  }
  const v1 = v1Schema.safeParse(raw);
  if (!v1.success) throw corrupt(source, v1.error);
  return v1.data;
}

const corrupt = (source: string, err: z.ZodError) =>
  new AmcError(
    'LOCK_CORRUPT',
    `${source}: ${err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
  );

/** Stable JSON: sorted keys, so lockfile diffs stay small. */
export function serializeLockfile(lock: Lockfile): string {
  const sortObj = <T>(o: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const regions = Object.fromEntries(
    Object.entries(lock.regions)
      .filter(([, r]) => Object.keys(r).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rel, r]) => [rel, sortObj(r)]),
  );
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        amcVersion: AMC_VERSION,
        files: sortObj(lock.files),
        ...(Object.keys(regions).length ? { regions } : {}),
      },
      null,
      2,
    ) + '\n'
  );
}

export interface LockRead {
  lock: Lockfile;
  path: string;
  /** Hash of the lockfile bytes, or null when there is none (for the plan's readHashes). */
  hash: string | null;
}

/** Reads `<root>/.amc-lock.json`. A missing lockfile is an empty one; a broken one throws. */
export async function readLockfile(fs: FsPort, root: string): Promise<LockRead> {
  const path = join(root, LOCKFILE);
  if (!(await fs.stat(path))) return { lock: emptyLockfile(), path, hash: null };
  const bytes = await fs.readFile(path);
  return { lock: parseLockfile(bytes.toString('utf8'), path), path, hash: sha256(bytes) };
}

export function getEntry(lock: Lockfile, relPath: string, region?: string): LockEntry | undefined {
  return region ? lock.regions[relPath]?.[region] : lock.files[relPath];
}

/** Returns a copy with the entry set (or removed when `entry` is null). */
export function setEntry(
  lock: Lockfile,
  relPath: string,
  region: string | undefined,
  entry: LockEntry | null,
): Lockfile {
  const next: Lockfile = {
    ...lock,
    files: { ...lock.files },
    regions: Object.fromEntries(Object.entries(lock.regions).map(([k, v]) => [k, { ...v }])),
  };
  if (region) {
    const r = (next.regions[relPath] ??= {});
    if (entry) r[region] = entry;
    else delete r[region];
    if (Object.keys(r).length === 0) delete next.regions[relPath];
  } else if (entry) next.files[relPath] = entry;
  else delete next.files[relPath];
  return next;
}

/** Every entry for one target, as `[relPath, region, entry]`. */
export function entriesFor(
  lock: Lockfile,
  targetId: string,
): Array<[string, string | undefined, LockEntry]> {
  const out: Array<[string, string | undefined, LockEntry]> = [];
  for (const [rel, e] of Object.entries(lock.files))
    if (e.targetId === targetId) out.push([rel, undefined, e]);
  for (const [rel, regions] of Object.entries(lock.regions)) {
    for (const [id, e] of Object.entries(regions))
      if (e.targetId === targetId) out.push([rel, id, e]);
  }
  return out;
}
