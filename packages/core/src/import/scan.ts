import type { AdapterRegistry } from '../adapter/registry';
import { targetId, type Target } from '../adapter/types';
import { groupCandidates } from './dedupe';
import { suggestLinks } from './suggest';
import type { Candidate, ScanResult } from './types';

export interface ScanProgress {
  toolId: string;
  done: number;
  total: number;
  label?: string;
}

export interface ScanDeps {
  adapters: AdapterRegistry;
  onProgress?: (progress: ScanProgress) => void;
}

/**
 * Reads what every target already has and parses it into canonical drafts (T1.8.1).
 *
 * Strictly read-only: `scan` and `parse` never write, and nothing here touches the library. A
 * tool that fails to scan is reported and skipped rather than failing the whole import — one
 * unreadable folder should not stop you importing the rest.
 */
export async function scanTargets(
  deps: ScanDeps,
  targets: readonly Target[],
  existingIds: ReadonlySet<string> = new Set(),
): Promise<ScanResult> {
  const candidates: Candidate[] = [];
  const warnings: string[] = [];
  let fileCount = 0;

  for (const [index, target] of targets.entries()) {
    const tid = targetId(target);
    deps.onProgress?.({ toolId: target.toolId, done: index, total: targets.length, label: tid });
    let adapter;
    try {
      adapter = deps.adapters.get(target.toolId);
    } catch {
      warnings.push(`No adapter for ${target.toolId}; skipped.`);
      continue;
    }

    const roots = adapter.paths(target);
    let found;
    try {
      found = await adapter.scan(target);
    } catch (err) {
      warnings.push(`${tid}: ${(err as Error).message}`);
      continue;
    }

    for (const group of found) {
      fileCount += group.files.length;
      try {
        const { item, warnings: notes } = adapter.parse(group, target);
        candidates.push({
          id: `${tid}|${group.root}|${group.entry}`,
          targetId: tid,
          toolId: target.toolId,
          root: group.root,
          rootDir: roots[group.root] ?? '',
          entry: group.entry,
          files: group.files,
          linked: group.linked,
          kind: group.kind,
          item,
          warnings: notes,
        });
      } catch (err) {
        warnings.push(`${tid} ${group.entry}: ${(err as Error).message}`);
      }
    }
  }

  deps.onProgress?.({ toolId: '', done: targets.length, total: targets.length });

  // Deterministic order, so two scans of the same disk produce the same groups.
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = suggestLinks(groupCandidates(candidates, existingIds), candidates);
  return { candidates, groups, fileCount, warnings };
}
