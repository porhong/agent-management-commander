import type { ItemId } from '../model/common';
import type { LibraryItem } from '../library/item-io';
import type { LoadProblem } from '../library/service';
import { buildGraph } from '../resolver/graph';
import type { Issue, Rule, ValidationContext, ValidationTarget } from './types';

export interface ValidateInput {
  items: readonly LibraryItem[];
  problems?: readonly LoadProblem[];
  targets?: readonly ValidationTarget[];
  deployed?: ReadonlySet<ItemId>;
  /** Keep only issues about these items (e.g. a deploy selection's closure). */
  only?: ReadonlySet<ItemId>;
}

const RANK = { error: 0, warning: 1, info: 2 } as const;

/** Runs registered rules (T1.2.4). Adapters add per-target rules with `register`. */
export class Validator {
  private readonly rules = new Map<string, Rule>();

  constructor(rules: Iterable<Rule> = []) {
    for (const r of rules) this.register(r);
  }

  register(rule: Rule): this {
    if (this.rules.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`);
    this.rules.set(rule.id, rule);
    return this;
  }

  get ruleIds(): string[] {
    return [...this.rules.keys()];
  }

  validate(input: ValidateInput): Issue[] {
    const ctx: ValidationContext = {
      items: input.items,
      graph: buildGraph(input.items),
      problems: input.problems ?? [],
      targets: input.targets ?? [],
      deployed: input.deployed,
    };
    const issues: Issue[] = [];
    for (const rule of this.rules.values()) {
      for (const f of rule.check(ctx)) {
        const severity = f.severity ?? rule.severity;
        const issue = {
          ...f,
          ruleId: rule.id,
          severity,
          blocking: f.blocking ?? severity === 'error',
        };
        if (input.only && !(issue.itemId && input.only.has(issue.itemId))) continue;
        issues.push(issue);
      }
    }
    return issues.sort(
      (a, b) =>
        RANK[a.severity] - RANK[b.severity] ||
        (a.itemId ?? '').localeCompare(b.itemId ?? '') ||
        a.ruleId.localeCompare(b.ruleId) ||
        (a.targetId ?? '').localeCompare(b.targetId ?? ''),
    );
  }
}

export const hasBlockingIssues = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.blocking);
