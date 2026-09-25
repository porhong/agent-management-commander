import { sha256 } from '../fs/text';
import type { Candidate, CandidateGroup, CandidateSource } from './types';

/**
 * Grouping the same item found in several tools (T1.8.2).
 *
 * Two passes, cheapest first: the same normalized slug is the same item, and beyond that two
 * bodies count as the same when they normalize to identical text, or when their line shingles
 * overlap by at least `SIMILARITY`.
 */
export const SIMILARITY = 0.85;

/** Slugs differ between tools only by case and separators, so normalize those away. */
export const normalizeSlug = (slug: string): string =>
  slug
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Text as it would read aloud: no frontmatter-ish leading metadata differences, no trailing
 * whitespace, no blank lines, lowercase. Two tools' renderings of one skill land here together.
 */
export const normalizeBody = (body: string): string =>
  body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd().toLowerCase())
    .filter((line) => line.length > 0)
    .join('\n');

/** Overlapping two-line windows, which catch a moved paragraph better than single lines do. */
export function shingles(body: string): Set<string> {
  const lines = normalizeBody(body).split('\n').filter(Boolean);
  if (lines.length === 0) return new Set();
  if (lines.length === 1) return new Set(lines);
  const out = new Set<string>();
  for (let i = 0; i < lines.length - 1; i++) out.add(`${lines[i]}\u0000${lines[i + 1]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * How good a source is to take the canonical content from: the one that kept the most fields
 * and needed the fewest apologies. Ties break on id, so a scan is deterministic.
 */
function score(candidate: Candidate): number {
  const manifest = candidate.item.manifest as unknown as Record<string, unknown>;
  const fields = Object.entries(manifest).filter(([, v]) => {
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    return String(v).length > 0;
  }).length;
  return fields * 1000 + candidate.item.body.length - candidate.warnings.length * 100;
}

const better = (a: Candidate, b: Candidate): Candidate => {
  const diff = score(a) - score(b);
  if (diff !== 0) return diff > 0 ? a : b;
  return a.id <= b.id ? a : b;
};

/** Groups candidates, choosing one source per group and recording how the rest matched it. */
export function groupCandidates(
  candidates: readonly Candidate[],
  existingIds: ReadonlySet<string> = new Set(),
): CandidateGroup[] {
  // Pass 1: the same kind and normalized slug is the same item, no content check needed.
  const bySlug = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}.${normalizeSlug(candidate.item.manifest.slug)}`;
    bySlug.set(key, [...(bySlug.get(key) ?? []), candidate]);
  }

  type Bucket = { members: Candidate[]; hash: string; shingle: Set<string> };
  const buckets: Bucket[] = [...bySlug.values()]
    .map((members) => {
      const canonical = members.reduce(better);
      return {
        members,
        hash: sha256(Buffer.from(normalizeBody(canonical.item.body))),
        shingle: shingles(canonical.item.body),
      };
    })
    // Deterministic order before merging, so the survivor never depends on scan order.
    .sort((a, b) => (a.members.reduce(better).id < b.members.reduce(better).id ? -1 : 1));

  // Pass 2: merge buckets whose canonical bodies are the same text, or close enough to it.
  const merged: Bucket[] = [];
  for (const bucket of buckets) {
    const kind = bucket.members[0]!.kind;
    const into = merged.find(
      (other) =>
        other.members[0]!.kind === kind &&
        (other.hash === bucket.hash || jaccard(other.shingle, bucket.shingle) >= SIMILARITY),
    );
    if (into) into.members.push(...bucket.members);
    else merged.push(bucket);
  }

  return merged.map((bucket) => {
    const canonical = bucket.members.reduce(better);
    const canonicalHash = sha256(Buffer.from(normalizeBody(canonical.item.body)));
    const canonicalShingle = shingles(canonical.item.body);
    const sources: CandidateSource[] = bucket.members
      .map((member): CandidateSource => {
        if (member.id === canonical.id) {
          return { candidateId: member.id, reason: 'same-content', similarity: 1 };
        }
        const hash = sha256(Buffer.from(normalizeBody(member.item.body)));
        if (hash === canonicalHash) {
          return { candidateId: member.id, reason: 'same-content', similarity: 1 };
        }
        const similarity = jaccard(canonicalShingle, shingles(member.item.body));
        return {
          candidateId: member.id,
          reason: similarity >= SIMILARITY ? 'similar' : 'same-slug',
          similarity: Math.round(similarity * 100) / 100,
        };
      })
      .sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1));

    const slug = normalizeSlug(canonical.item.manifest.slug);
    const key = `${canonical.kind}.${slug}`;
    return {
      key,
      kind: canonical.kind,
      slug,
      canonicalId: canonical.id,
      sources,
      ...(existingIds.has(key) && { existingId: key }),
      suggestions: [],
    };
  });
}
