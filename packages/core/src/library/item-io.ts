import { join } from 'node:path';
import YAML from 'yaml';
import { AmcError, isAmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { safeJoin, stripBom } from '../fs/text';
import { BODY_FILE, type Manifest, type ModeledKind } from '../model/manifests';
import { parseManifest } from '../model/parse';

export const MANIFEST_FILE = 'amc.yaml';

export interface LibraryItem {
  manifest: Manifest;
  /** Content of the kind's body file (SKILL.md / prompt.md / template.md). */
  body: string;
  /** Supporting files (e.g. `references/x.md`, `scripts/y.ps1`), `/`-separated relative paths. */
  files: Record<string, Buffer>;
}

/** `library/skills/<slug>` etc. */
export const kindDir = (kind: ModeledKind): string => `${kind}s`;
export const itemDir = (libraryRoot: string, m: Pick<Manifest, 'kind' | 'slug'>): string =>
  join(libraryRoot, kindDir(m.kind), m.slug);

// Stable key order keeps git diffs minimal and makes write(read(x)) byte-identical.
const KEY_ORDER = [
  'id',
  'kind',
  'name',
  'slug',
  'version',
  'description',
  'tags',
  'author',
  'license',
  'createdAt',
  'updatedAt',
  // skill
  'triggers',
  'dependsOn',
  'allowedTools',
  'scripts',
  // agent
  'model',
  'tools',
  'skills',
  'delegatesTo',
  // command
  'arguments',
  'agent',
  'preloadSkills',
  'compat',
];

const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  (Array.isArray(v) && v.length === 0) ||
  (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Drops empty values recursively (parse re-applies defaults), so files stay minimal. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v);
      if (!isEmpty(p)) out[k] = p;
    }
    return out;
  }
  return value;
}

export function serializeManifest(m: Manifest): string {
  const pruned = prune(m) as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (k in pruned) ordered[k] = pruned[k];
  for (const k of Object.keys(pruned).sort()) if (!(k in ordered)) ordered[k] = pruned[k];
  return YAML.stringify(ordered, { lineWidth: 0, indent: 2 });
}

export function deserializeManifest(text: string, source = MANIFEST_FILE): Manifest {
  let raw: unknown;
  try {
    raw = YAML.parse(stripBom(text));
  } catch (err) {
    throw new AmcError('MANIFEST_PARSE_FAILED', `${source}: ${(err as Error).message}`);
  }
  return parseManifest(raw);
}

/** Dotfiles/dot-folders (e.g. `.DS_Store`, editor temp files) are never part of an item. */
const isHidden = (rel: string): boolean => rel.split('/').some((seg) => seg.startsWith('.'));

export async function readItem(fs: FsPort, dir: string): Promise<LibraryItem> {
  const manifest = deserializeManifest(
    (await fs.readFile(join(dir, MANIFEST_FILE))).toString('utf8'),
    join(dir, MANIFEST_FILE),
  );
  const folder = dir.split(/[\\/]/).filter(Boolean).pop();
  if (folder !== manifest.slug) {
    throw new AmcError(
      'ITEM_LAYOUT_INVALID',
      `Folder "${folder}" does not match slug "${manifest.slug}"`,
    );
  }

  const bodyFile = BODY_FILE[manifest.kind];
  let body = '';
  try {
    body = stripBom((await fs.readFile(join(dir, bodyFile))).toString('utf8'));
  } catch (err) {
    if (!isAmcError(err, 'FS_NOT_FOUND')) throw err;
  }

  const files: Record<string, Buffer> = {};
  for (const entry of await fs.readdir(dir, { recursive: true })) {
    if (entry.kind !== 'file' || entry.path === MANIFEST_FILE || entry.path === bodyFile) continue;
    if (isHidden(entry.path)) continue;
    files[entry.path] = await fs.readFile(join(dir, ...entry.path.split('/')));
  }
  return { manifest, body, files };
}

/**
 * Writes an item folder. Stale files that are no longer part of the item are removed, so the
 * folder always mirrors `item` exactly. Supporting-file paths are confined to the folder (S4).
 */
export async function writeItem(fs: FsPort, dir: string, item: LibraryItem): Promise<void> {
  const bodyFile = BODY_FILE[item.manifest.kind];
  const wanted = new Map<string, Buffer | string>([
    [MANIFEST_FILE, serializeManifest(item.manifest)],
    [bodyFile, item.body],
  ]);
  for (const [rel, data] of Object.entries(item.files)) {
    if (rel === MANIFEST_FILE || rel === bodyFile) {
      throw new AmcError('ITEM_LAYOUT_INVALID', `Supporting file collides with ${rel}`);
    }
    safeJoin(dir, rel);
    wanted.set(rel, data);
  }

  for (const [rel, data] of wanted) await fs.writeFileAtomic(safeJoin(dir, rel), data);

  if (await fs.stat(dir)) {
    for (const entry of await fs.readdir(dir, { recursive: true })) {
      if (entry.kind === 'file' && !wanted.has(entry.path) && !isHidden(entry.path)) {
        await fs.rm(join(dir, ...entry.path.split('/')));
      }
    }
  }
}
