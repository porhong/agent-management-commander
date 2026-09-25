// Helpers for core tests only; not exported from index.ts.
import type { LibraryItem } from './library/item-io';
import { parseManifest } from './model/parse';

/** A valid in-memory item from its id, e.g. `mk('skill.sec', { dependsOn: [...] })`. */
export function mk(
  id: string,
  fields: Record<string, unknown> = {},
  body = '',
  files: Record<string, Buffer> = {},
): LibraryItem {
  const [kind, slug] = id.split('.') as [string, string];
  return {
    manifest: parseManifest({ id, kind, slug, name: slug, description: 'x', ...fields }),
    body,
    files,
  };
}
