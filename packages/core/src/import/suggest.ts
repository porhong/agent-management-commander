import type { ModeledKind } from '../model/manifests';
import type { RefRelation } from '../model/refs';
import type { Candidate, CandidateGroup, LinkSuggestion } from './types';

/**
 * Links implied by one item's text mentioning another's slug (T1.8.3).
 *
 * These are guesses from prose, so they are only ever offered: nothing here is applied without
 * the user accepting it, and every suggestion carries the line it came from as evidence.
 */

/** Which relation a mention implies, by the kinds at each end. Anything else is not suggested. */
const RELATION: Partial<Record<`${ModeledKind}->${ModeledKind}`, RefRelation>> = {
  'agent->skill': 'equips',
  'agent->agent': 'delegates-to',
  'command->agent': 'uses-agent',
  'command->skill': 'preloads',
  'skill->skill': 'depends-on',
};

/** Short slugs ("api", "go") match far too much ordinary prose to be worth guessing from. */
const MIN_SLUG = 4;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A slug on its own, or written the way a tool invokes it: `@name`, `/name`, `` `name` ``. */
const mentionOf = (slug: string) =>
  new RegExp(`(^|[^a-z0-9-])[@/\`]?${escape(slug)}([^a-z0-9-]|$)`, 'i');

export function suggestLinks(
  groups: readonly CandidateGroup[],
  candidates: readonly Candidate[],
): CandidateGroup[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));

  return groups.map((group) => {
    const source = byId.get(group.canonicalId);
    if (!source) return group;
    const haystack = `${source.item.body}\n${source.item.manifest.description}`;
    const lines = haystack.split(/\r?\n/);
    const suggestions: LinkSuggestion[] = [];

    for (const other of groups) {
      if (other.key === group.key) continue;
      const relation = RELATION[`${group.kind}->${other.kind}`];
      if (!relation || other.slug.length < MIN_SLUG) continue;

      const pattern = mentionOf(other.slug);
      const line = lines.find((l) => pattern.test(l));
      if (line === undefined) continue;

      const evidence = line.trim();
      suggestions.push({
        to: other.key,
        relation,
        evidence: evidence.length > 160 ? `${evidence.slice(0, 157)}…` : evidence,
      });
    }

    return { ...group, suggestions: suggestions.sort((a, b) => (a.to < b.to ? -1 : 1)) };
  });
}
