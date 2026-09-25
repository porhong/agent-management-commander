import { AmcError } from '../errors';
import type { ItemId } from '../model/common';
import type { RefRelation } from '../model/refs';
import type { LibraryItem } from '../library/item-io';
import { findCycles, type RefGraph } from './graph';

/** A reference with its target already resolved. */
export interface ResolvedRef {
  relation: RefRelation;
  mode?: 'on-demand' | 'always';
  target: ResolvedItem;
}

/**
 * An item with everything it references embedded (T1.2.3), so `compile` stays pure: an adapter
 * gets an agent together with its equipped skills' manifests and bodies and never reads the
 * library itself. Shared dependencies are the same object, so the structure is a DAG.
 */
export interface ResolvedItem {
  item: LibraryItem;
  refs: ResolvedRef[];
}

/**
 * The transitive closure of `ids`, dependencies before dependents (T1.2.2). Throws REF_BROKEN or
 * REF_CYCLE; run the validator first to get the same problems as readable issues.
 */
export function resolveClosure(graph: RefGraph, ids: readonly ItemId[]): ResolvedItem[] {
  const resolved = new Map<ItemId, ResolvedItem>();
  const order: ResolvedItem[] = [];
  const visiting = new Set<ItemId>();

  const visit = (id: ItemId, from?: ItemId): ResolvedItem => {
    const done = resolved.get(id);
    if (done) return done;
    const item = graph.items.get(id);
    if (!item) {
      const msg = from ? `${from} references missing ${id}` : `No item ${id}`;
      throw new AmcError('REF_BROKEN', msg, { from, to: id });
    }
    if (visiting.has(id)) {
      const cycle = findCycles(graph).find((c) => c.includes(id)) ?? [id, id];
      throw new AmcError('REF_CYCLE', `Reference cycle: ${cycle.join(' → ')}`, cycle);
    }
    visiting.add(id);
    const refs = graph.uses(id).map((e) => ({
      relation: e.relation,
      ...(e.mode ? { mode: e.mode } : {}),
      target: visit(e.to, id),
    }));
    visiting.delete(id);
    const node = { item, refs };
    resolved.set(id, node);
    order.push(node);
    return node;
  };

  for (const id of ids) visit(id);
  return order;
}
