import type { z } from 'zod';
import { AmcError } from '../errors';
import { manifestSchemas, type Manifest, type ModeledKind } from './manifests';

export interface ManifestIssue {
  /** Dotted field path, e.g. `skills.0.ref`. */
  path: string;
  message: string;
}

const toIssues = (err: z.ZodError): ManifestIssue[] =>
  err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));

/** Validates raw manifest data. Throws MANIFEST_INVALID with readable, field-pathed issues. */
export function parseManifest(raw: unknown): Manifest {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (typeof kind !== 'string' || !(kind in manifestSchemas)) {
    throw new AmcError('MANIFEST_INVALID', `Unknown or missing kind: ${String(kind)}`, [
      { path: 'kind', message: `expected one of ${Object.keys(manifestSchemas).join(', ')}` },
    ] satisfies ManifestIssue[]);
  }
  const result = manifestSchemas[kind as ModeledKind].safeParse(raw);
  if (!result.success) {
    const issues = toIssues(result.error);
    throw new AmcError(
      'MANIFEST_INVALID',
      issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      issues,
    );
  }
  return result.data;
}
