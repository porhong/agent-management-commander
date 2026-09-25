import type { ItemId } from '../model/common';
import { referencesOf, type ItemRef } from '../model/refs';
import type { LibraryItem } from '../library/item-io';

export interface Edge extends ItemRef {
  from: ItemId;
}

/** The library's reference graph with a reverse index (T1.2.1). Immutable once built. */
export interface RefGraph {
  readonly items: ReadonlyMap<ItemId, LibraryItem>;
  /** Outgoing references of `id`, in declaration order. */
  uses(id: ItemId): readonly Edge[];
  /** Incoming references to `id`, ordered by referrer id. */
  usedBy(id: ItemId): readonly Edge[];
  /** Edges whose target isn't in the library. */
  readonly broken: readonly Edge[];
}

export function buildGraph(items: Iterable<LibraryItem>): RefGraph {
  const byId = new Map<ItemId, LibraryItem>();
  for (const item of items) byId.set(item.manifest.id, item);

  const out = new Map<ItemId, Edge[]>();
  const into = new Map<ItemId, Edge[]>();
  const broken: Edge[] = [];
  for (const id of [...byId.keys()].sort()) {
    const edges = referencesOf(byId.get(id)!.manifest).map((r) => ({ ...r, from: id }));
    out.set(id, edges);
    for (const e of edges) {
      if (!byId.has(e.to)) broken.push(e);
      else (into.get(e.to) ?? into.set(e.to, []).get(e.to)!).push(e);
    }
  }

  return {
    items: byId,
    uses: (id) => out.get(id) ?? [],
    usedBy: (id) => into.get(id) ?? [],
    broken,
  };
}

/**
 * Reference cycles, each as a closed path `[a, b, c, a]` (T1.2.2). Uses Tarjan's SCC algorithm,
 * then walks one concrete cycle inside each strongly connected component. Deterministic.
 */
export function findCycles(graph: RefGraph): ItemId[][] {
  const index = new Map<ItemId, number>();
  const low = new Map<ItemId, number>();
  const onStack = new Set<ItemId>();
  const stack: ItemId[] = [];
  const sccs: ItemId[][] = [];
  let next = 0;

  const targets = (id: ItemId): ItemId[] =>
    graph.uses(id).flatMap((e) => (graph.items.has(e.to) ? [e.to] : []));

  // Iterative to stay safe on long dependency chains.
  const strongConnect = (root: ItemId): void => {
    const work: Array<{ id: ItemId; i: number }> = [{ id: root, i: 0 }];
    index.set(root, next);
    low.set(root, next++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const succ = targets(frame.id);
      if (frame.i < succ.length) {
        const w = succ[frame.i++]!;
        if (!index.has(w)) {
          index.set(w, next);
          low.set(w, next++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === index.get(frame.id)) {
        const scc: ItemId[] = [];
        let w: ItemId;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== frame.id);
        sccs.push(scc);
      }
    }
  };

  for (const id of [...graph.items.keys()].sort()) if (!index.has(id)) strongConnect(id);

  const cycles: ItemId[][] = [];
  for (const scc of sccs) {
    const members = new Set(scc);
    const start = [...scc].sort()[0]!;
    if (scc.length === 1 && !targets(start).includes(start)) continue;
    cycles.push(cycleThrough(start, members, targets));
  }
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/** A shortest cycle from `start` back to itself, staying inside one SCC (BFS). */
function cycleThrough(
  start: ItemId,
  members: Set<ItemId>,
  targets: (id: ItemId) => ItemId[],
): ItemId[] {
  const prev = new Map<ItemId, ItemId>();
  const queue: ItemId[] = [start];
  while (queue.length > 0) {
    const v = queue.shift()!;
    for (const w of targets(v)) {
      if (!members.has(w)) continue;
      if (w === start) {
        const path = [start];
        for (let c: ItemId | undefined = v; c !== undefined && c !== start; c = prev.get(c)) {
          path.push(c);
        }
        return [start, ...path.slice(1).reverse(), start];
      }
      if (!prev.has(w)) {
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [start, start]; // unreachable for a real SCC
}
