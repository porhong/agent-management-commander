import { AmcError } from '../errors';
import type { LibraryService } from '../library/service';
import type { ItemId } from '../model/common';
import type { RefRelation } from '../model/refs';
import type { ScanResult } from './types';

export interface AdoptLink {
  /** Group key of the other item. */
  to: string;
  relation: RefRelation;
}

export interface AdoptDecision {
  /** Group key from the scan. */
  key: string;
  /** The slug to use; the user may have renamed it to settle a clash. */
  slug: string;
  /** Which source's content to take. Defaults to the group's canonical one. */
  candidateId?: string;
  /** Suggestions the user accepted. Anything not listed here is simply not applied. */
  links?: AdoptLink[];
}

export interface AdoptResult {
  created: ItemId[];
  skipped: Array<{ key: string; reason: string }>;
  /** References that could not be carried over, so the loss is never silent. */
  notes: string[];
  /** Targets the adopted items came from, so the UI can offer to record ownership next. */
  targetIds: string[];
}

/** Manifest field ↔ relation. Reference fields are rebuilt after every item has its final id. */
const FIELD_OF: Record<RefRelation, string> = {
  equips: 'skills',
  'delegates-to': 'delegatesTo',
  'uses-agent': 'agent',
  preloads: 'preloadSkills',
  'depends-on': 'dependsOn',
};
const RELATION_OF = Object.fromEntries(
  Object.entries(FIELD_OF).map(([relation, field]) => [field, relation as RefRelation]),
) as Record<string, RefRelation>;

/** `skills` holds `{ref, mode}`; every other reference field holds plain ids. */
const SINGLE = new Set(['agent']);

interface Ref {
  relation: RefRelation;
  /** Group key or library id, before remapping. */
  to: string;
  mode?: string;
}

/** Pulls the references a native manifest already declared, so importing never loses wiring. */
function refsOf(manifest: Record<string, unknown>): Ref[] {
  const out: Ref[] = [];
  for (const [field, relation] of Object.entries(RELATION_OF)) {
    const value = manifest[field];
    if (value === undefined || value === null) continue;
    if (SINGLE.has(field)) {
      out.push({ relation, to: String(value) });
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') out.push({ relation, to: entry });
        else if (entry && typeof entry === 'object' && 'ref' in entry) {
          const { ref, mode } = entry as { ref: string; mode?: string };
          out.push({ relation, to: ref, ...(mode && { mode }) });
        }
      }
    }
  }
  return out;
}

/**
 * Writes the chosen candidates into the library (T1.8.4).
 *
 * **Nothing is written to any tool folder here** (S6). Recording that those files are now
 * AMC-managed is a separate, reviewable deploy: the compiled output of an adopted item usually
 * matches the file it came from, so that plan changes no bytes and only writes the lockfile.
 */
export async function adoptCandidates(
  library: LibraryService,
  scan: ScanResult,
  decisions: readonly AdoptDecision[],
): Promise<AdoptResult> {
  const byId = new Map(scan.candidates.map((c) => [c.id, c]));
  const byKey = new Map(scan.groups.map((g) => [g.key, g]));

  const created: ItemId[] = [];
  const skipped: AdoptResult['skipped'] = [];
  const notes: string[] = [];
  const targetIds = new Set<string>();
  /** Group key → the id the item actually got, which is what references must point at. */
  const idOf = new Map<string, ItemId>();

  for (const decision of decisions) {
    const group = byKey.get(decision.key);
    if (!group) {
      skipped.push({ key: decision.key, reason: 'That group is not in this scan any more.' });
      continue;
    }
    const candidate = byId.get(decision.candidateId ?? group.canonicalId);
    if (!candidate) {
      skipped.push({ key: decision.key, reason: 'The chosen source is not in this scan.' });
      continue;
    }

    const manifest = candidate.item.manifest as unknown as Record<string, unknown>;
    // The library assigns id, version and stamps; references are rebuilt in the second pass,
    // once every adopted item has the id its neighbours must point at.
    const fields = { ...manifest };
    for (const key of [
      'id',
      'kind',
      'slug',
      'version',
      'createdAt',
      'updatedAt',
      'name',
      'description',
    ]) {
      delete fields[key];
    }
    for (const field of Object.keys(RELATION_OF)) delete fields[field];

    try {
      const item = await library.create({
        kind: candidate.kind,
        slug: decision.slug,
        name: String(manifest['name'] ?? decision.slug),
        description: String(manifest['description'] ?? ''),
        fields,
        body: candidate.item.body,
        files: candidate.item.files,
      });
      created.push(item.manifest.id);
      idOf.set(group.key, item.manifest.id);
      for (const source of group.sources) {
        const from = byId.get(source.candidateId);
        if (from) targetIds.add(from.targetId);
      }
    } catch (err) {
      skipped.push({
        key: decision.key,
        reason: err instanceof AmcError ? err.message : String(err),
      });
    }
  }

  /** A reference survives if its item was adopted now, or was already in the library. */
  const resolve = async (to: string): Promise<ItemId | null> => {
    const adopted = idOf.get(to);
    if (adopted) return adopted;
    try {
      return (await library.get(to as ItemId)).manifest.id;
    } catch {
      return null;
    }
  };

  for (const decision of decisions) {
    const id = idOf.get(decision.key);
    const group = byKey.get(decision.key);
    if (!id || !group) continue;
    const candidate = byId.get(decision.candidateId ?? group.canonicalId)!;

    const wanted = [
      ...refsOf(candidate.item.manifest as unknown as Record<string, unknown>),
      ...(decision.links ?? []).map((link): Ref => ({ relation: link.relation, to: link.to })),
    ];

    const fields: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const ref of wanted) {
      const target = await resolve(ref.to);
      if (!target) {
        notes.push(`${id}: dropped its reference to ${ref.to}, which was not imported.`);
        continue;
      }
      const field = FIELD_OF[ref.relation];
      if (seen.has(`${field}|${target}`)) continue;
      seen.add(`${field}|${target}`);
      if (SINGLE.has(field)) fields[field] = target;
      else {
        const entry = field === 'skills' ? { ref: target, mode: ref.mode ?? 'on-demand' } : target;
        fields[field] = [...((fields[field] as unknown[]) ?? []), entry];
      }
    }

    if (Object.keys(fields).length > 0) await library.update(id, { fields });
  }

  return { created, skipped, notes, targetIds: [...targetIds].sort() };
}
