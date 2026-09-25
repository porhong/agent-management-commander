import type { ChannelOutput, TargetRef } from '../../../shared/ipc-contract';

export type TargetRow = ChannelOutput<'targets.list'>[number];
export type MatrixRow = ChannelOutput<'deploy.matrix'>[number];
export type Plan = ChannelOutput<'deploy.plan'>;
export type PlanTarget = Plan['targets'][number];
export type Change = PlanTarget['changes'][number];

/**
 * How the renderer names a target to main. A project root is named by the token main issued
 * for it, never by its path (see the note on `targets.list` in the contract).
 */
export function targetRefOf(row: TargetRow): TargetRef | null {
  if (row.scope === 'global') return { toolId: row.toolId, scope: 'global' };
  return row.token ? { toolId: row.toolId, scope: 'project', token: row.token } : null;
}

/**
 * A plan is declarative: a target ends up holding exactly the items the selection names, and
 * anything else AMC put there is retired. So every entry point has to start from what is
 * already deployed and add to it — otherwise deploying one item would remove all the others.
 */
export const deployedIn = (matrix: readonly MatrixRow[], targetId: string): string[] =>
  matrix
    .filter((row) => row.targetId === targetId && row.status !== 'missing')
    .map((r) => r.itemId);

export interface Selection {
  target: TargetRef;
  items: string[];
}

/** The selection that adds `add` to a target and keeps what it already has, minus `remove`. */
export function selectionFor(
  row: TargetRow,
  matrix: readonly MatrixRow[],
  add: readonly string[] = [],
  remove: readonly string[] = [],
): Selection | null {
  const target = targetRefOf(row);
  if (!target) return null;
  const items = new Set([...deployedIn(matrix, row.targetId), ...add]);
  for (const id of remove) items.delete(id);
  return { target, items: [...items].sort() };
}

export const conflictsOf = (plan: Plan): Change[] =>
  plan.targets.flatMap((t) => t.changes.filter((c) => c.op === 'conflict'));

export const blockingIssues = (plan: Plan) => plan.issues.filter((i) => i.blocking);

/** Changes worth showing: an unchanged file is noise in a review. */
export const realChanges = (target: PlanTarget): Change[] =>
  target.changes.filter((c) => c.op !== 'unchanged');

export const countsOf = (plan: Plan): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const target of plan.targets) {
    for (const change of target.changes) counts[change.op] = (counts[change.op] ?? 0) + 1;
  }
  return counts;
};

/** What a target's auto-apply resolves to, given the global default and any override. */
export function autoApplyFor(
  settings: Record<string, unknown> | undefined,
  targetId: string,
): 'ask' | 'when-no-conflicts' {
  const per = (
    settings?.['targetSettings'] as Record<string, { autoApply?: string }> | undefined
  )?.[targetId]?.autoApply;
  const value = per && per !== 'inherit' ? per : settings?.['autoApply'];
  return value === 'when-no-conflicts' ? 'when-no-conflicts' : 'ask';
}
