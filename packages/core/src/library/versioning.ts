import type { Manifest } from '../model/manifests';
import { serializeManifest, type LibraryItem } from './item-io';

export type BumpLevel = 'patch' | 'minor' | 'major';

/** semver `inc` semantics: a pre-release bumps to its own release first (1.2.3-beta.1 → 1.2.3). */
export function bumpVersion(version: string, level: BumpLevel): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[^+]+)?/.exec(version);
  if (!m) throw new Error(`Not a semver version: ${version}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4] !== undefined;
  switch (level) {
    case 'major':
      return pre && min === 0 && pat === 0 ? `${maj}.0.0` : `${maj + 1}.0.0`;
    case 'minor':
      return pre && pat === 0 ? `${maj}.${min}.0` : `${maj}.${min + 1}.0`;
    case 'patch':
      return pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
  }
}

/** Fields that describe an item without changing what gets deployed. Editing them never bumps. */
const METADATA_KEYS = ['version', 'tags', 'author', 'license', 'createdAt', 'updatedAt'] as const;

const fingerprint = (item: LibraryItem, drop: readonly string[]): string => {
  const m: Record<string, unknown> = { ...item.manifest };
  for (const k of drop) delete m[k];
  const files = Object.keys(item.files)
    .sort()
    .map((k) => `${k}\0${item.files[k]!.toString('base64')}`);
  return [serializeManifest(m as Manifest), item.body, ...files].join('\0\0');
};

/** True when anything that affects compiled output differs. */
export const contentChanged = (a: LibraryItem, b: LibraryItem): boolean =>
  fingerprint(a, METADATA_KEYS) !== fingerprint(b, METADATA_KEYS);

/** True when anything at all differs, ignoring only the `updatedAt` stamp. */
export const anyChanged = (a: LibraryItem, b: LibraryItem): boolean =>
  fingerprint(a, ['updatedAt']) !== fingerprint(b, ['updatedAt']);
