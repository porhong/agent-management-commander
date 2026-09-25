import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@/lib/ipc';
import { metaOf, slugOf } from '@/lib/kinds';

/** Plain English for each edge, read from the referring item's side. */
const RELATION: Record<string, { forward: string; backward: string }> = {
  equips: { forward: 'is equipped with', backward: 'is equipped by' },
  'delegates-to': { forward: 'may delegate to', backward: 'is delegated to by' },
  'uses-agent': { forward: 'runs as', backward: 'runs' },
  preloads: { forward: 'preloads', backward: 'is preloaded by' },
  'depends-on': { forward: 'depends on', backward: 'is required by' },
};

type Edge = { id: string; relation: string; mode: string | null };

/**
 * Uses and used-by (T1.6.8). Deliberately two lists rather than a graph: what a person needs
 * here is "what does deploying this drag along" and "what breaks if I change it".
 */
export function RelationsTab({ id }: { id: string }) {
  const relations = useQuery('library.relations', { id }, { on: ['library.changed'] });
  const uses = relations.data?.uses ?? [];
  const usedBy = relations.data?.usedBy ?? [];

  return (
    <div className="max-w-2xl p-4">
      <section>
        <h2 className="font-medium">Uses</h2>
        <p className="mt-1 text-muted-foreground">
          Deployed together with this item, so a tool always has the whole set.
        </p>
        <EdgeList edges={uses} direction="forward" empty="This item references nothing else." />
      </section>

      <section className="mt-6">
        <h2 className="font-medium">Used by</h2>
        <p className="mt-1 text-muted-foreground">
          Changing this item changes what these receive. It cannot be deleted while they exist.
        </p>
        <EdgeList edges={usedBy} direction="backward" empty="Nothing references this item yet." />
      </section>
    </div>
  );
}

function EdgeList({
  edges,
  direction,
  empty,
}: {
  edges: Edge[];
  direction: 'forward' | 'backward';
  empty: string;
}) {
  if (edges.length === 0) return <p className="mt-2 text-muted-foreground">{empty}</p>;
  return (
    <ul className="mt-2 divide-y rounded-md border">
      {edges.map((edge) => {
        const meta = metaOf(edge.id);
        return (
          <li key={`${edge.relation}|${edge.id}`} className="flex items-center gap-2 p-2">
            <span className="w-32 shrink-0 text-muted-foreground">
              {RELATION[edge.relation]?.[direction] ?? edge.relation}
            </span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
            <Link to={`/item/${edge.id}`} className="hover:underline">
              {meta.sigil}
              {slugOf(edge.id)}
            </Link>
            {edge.mode && <span className="text-muted-foreground">({edge.mode})</span>}
          </li>
        );
      })}
    </ul>
  );
}
