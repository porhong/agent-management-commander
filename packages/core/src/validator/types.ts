import type { ItemId } from '../model/common';
import type { LibraryItem } from '../library/item-io';
import type { LoadProblem } from '../library/service';
import type { RefGraph } from '../resolver/graph';

export type Severity = 'error' | 'warning' | 'info';

/** A one-click repair: replace these manifest fields (via `LibraryService.update`). */
export interface IssueFix {
  label: string;
  itemId: ItemId;
  fields: Record<string, unknown>;
}

export interface Issue {
  ruleId: string;
  severity: Severity;
  message: string;
  itemId?: ItemId;
  /** Manifest field, e.g. `skills.0.ref`. */
  path?: string;
  /** Library-relative file, e.g. `skills/x/SKILL.md`, with an optional 1-based line. */
  file?: string;
  line?: number;
  /** Set for per-target rules. */
  targetId?: string;
  /** Blocks deploy. Always true for errors; some warnings block too (untrusted scripts). */
  blocking: boolean;
  fix?: IssueFix;
}

/** What a rule reports; the validator fills in `ruleId`, and defaults `severity`/`blocking`. */
export type RuleFinding = Omit<Issue, 'ruleId' | 'severity' | 'blocking'> & {
  severity?: Severity;
  blocking?: boolean;
};

export interface ValidationTarget {
  id: string;
  toolId: string;
}

export interface ValidationContext {
  items: readonly LibraryItem[];
  graph: RefGraph;
  /** Folders that failed to load (see `LibraryService.load`). */
  problems: readonly LoadProblem[];
  /** Targets in play; per-target rules report once per matching target. */
  targets: readonly ValidationTarget[];
  /** Ids deployed anywhere. Rules that need it are skipped when it's absent. */
  deployed?: ReadonlySet<ItemId>;
}

export interface Rule {
  id: string;
  severity: Severity;
  description: string;
  check(ctx: ValidationContext): RuleFinding[];
}
