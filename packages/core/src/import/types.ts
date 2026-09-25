import type { NativeFile } from '../adapter/types';
import type { LibraryItem } from '../library/item-io';
import type { ItemId } from '../model/common';
import type { ModeledKind } from '../model/manifests';
import type { RefRelation } from '../model/refs';

/** One native item found in one target, already parsed into a canonical draft. */
export interface Candidate {
  /** `<targetId>|<root>|<entry>` — stable across scans of the same disk. */
  id: string;
  targetId: string;
  toolId: string;
  /** Root key within the target (e.g. `claude`, `agents`). */
  root: string;
  rootDir: string;
  /** Primary file, relative to `rootDir`. */
  entry: string;
  files: NativeFile[];
  /** Reached through a symlink or junction: read, but never written through. */
  linked: boolean;
  kind: ModeledKind;
  item: LibraryItem;
  warnings: string[];
}

export type MatchReason = 'same-slug' | 'same-content' | 'similar';

export interface CandidateSource {
  candidateId: string;
  reason: MatchReason;
  /** 1 for an exact content match; the Jaccard score otherwise. */
  similarity: number;
}

/** A link one candidate's text implies. Always a suggestion; never applied on its own. */
export interface LinkSuggestion {
  to: string;
  relation: RefRelation;
  /** The line the slug was found on, trimmed, so the user can judge it. */
  evidence: string;
}

/** Candidates that look like the same item, wherever they were found. */
export interface CandidateGroup {
  /** `<kind>.<slug>` of the canonical candidate; the UI uses it as the group's key. */
  key: string;
  kind: ModeledKind;
  slug: string;
  canonicalId: string;
  sources: CandidateSource[];
  /** An item already in the library that this group would collide with. */
  existingId?: ItemId;
  suggestions: LinkSuggestion[];
}

export interface ScanResult {
  candidates: Candidate[];
  groups: CandidateGroup[];
  /** Native files read, for the progress readout. */
  fileCount: number;
  warnings: string[];
}
