import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Upload, X } from 'lucide-react';
import { PlanDialog, type PlanRequest } from '@/components/deploy/plan-dialog';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/dialog';
import { useQuery } from '@/lib/ipc';
import { deployedIn, selectionFor, targetRefOf } from '@/lib/deploy';
import { metaOf, slugOf } from '@/lib/kinds';

/**
 * The deploy screen (T1.7.2). Reached from the list, the editor, or the palette with
 * `?items=`. It only ever produces a plan — applying happens in the plan dialog.
 */
export function Deploy() {
  const [params] = useSearchParams();
  const requested = (params.get('items') ?? '').split(',').filter(Boolean);

  const library = useQuery('library.list', {}, { on: ['library.changed'] });
  const targets = useQuery('targets.list', undefined, { on: ['targets.changed'] });
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });

  const [items, setItems] = useState<string[]>(requested);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [request, setRequest] = useState<PlanRequest | null>(null);

  const rows = targets.data ?? [];
  // Everything, until the user says otherwise: most libraries have one or two targets.
  const selected = chosen ?? new Set(rows.map((r) => r.targetId));

  const selections = useMemo(
    () =>
      rows
        .filter((row) => selected.has(row.targetId))
        .map((row) => selectionFor(row, matrix.data ?? [], items))
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [rows, selected, matrix.data, items],
  );

  const nameOf = (id: string) => library.data?.find((r) => r.id === id)?.name ?? id;
  const candidates = (library.data ?? []).filter((row) => !items.includes(row.id));

  return (
    <div className="h-full overflow-auto p-4">
      <h1 className="text-lg font-semibold">Deploy</h1>
      <p className="mt-1 max-w-2xl text-muted-foreground">
        Pick what goes where. The next screen shows every file that would change, and nothing is
        written until you apply it.
      </p>

      <div className="mt-4 grid max-w-4xl gap-6 md:grid-cols-2">
        <section>
          <h2 className="font-medium">Items</h2>
          {items.length === 0 ? (
            <p className="mt-1 text-muted-foreground">
              Nothing chosen yet. Each target keeps whatever it already has.
            </p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border">
              {items.map((id) => {
                const meta = metaOf(id);
                return (
                  <li key={id} className="flex items-center gap-2 p-2">
                    <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
                    <span className="shrink-0">{nameOf(id)}</span>
                    <span className="id truncate text-muted-foreground">
                      {meta.sigil}
                      {slugOf(id)}
                    </span>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${nameOf(id)}`}
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {candidates.length > 0 && (
            <select
              className={`${inputClass} mt-2`}
              aria-label="Add an item"
              value=""
              onChange={(e) => e.target.value && setItems([...items, e.target.value])}
            >
              <option value="">Add an item…</option>
              {candidates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} — {row.description.slice(0, 60)}
                </option>
              ))}
            </select>
          )}
        </section>

        <section>
          <h2 className="font-medium">Targets</h2>
          {rows.length === 0 ? (
            <p className="mt-1 text-muted-foreground">
              No targets yet. Add one on the Targets screen.
            </p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border">
              {rows.map((row) => {
                const already = deployedIn(matrix.data ?? [], row.targetId);
                const adding = items.filter((id) => !already.includes(id));
                const usable = targetRefOf(row) !== null;
                return (
                  <li key={row.targetId} className="flex items-start gap-2 p-2">
                    <input
                      type="checkbox"
                      className="check mt-1"
                      checked={selected.has(row.targetId)}
                      disabled={!usable}
                      aria-label={row.label}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(row.targetId);
                        else next.delete(row.targetId);
                        setChosen(next);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{row.label}</p>
                      <p className="text-muted-foreground">
                        {already.length} there now
                        {adding.length > 0 && `, ${adding.length} being added`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 flex max-w-4xl items-center gap-3">
        <Button
          disabled={selections.length === 0}
          onClick={() => setRequest({ kind: 'deploy', selections })}
        >
          <Upload className="size-3.5" aria-hidden />
          Review the plan
        </Button>
        <p className="text-muted-foreground">
          A target ends up holding exactly what is listed for it, so anything AMC put there and is
          no longer listed is removed. Files AMC does not own are never touched.
        </p>
      </div>

      {request && (
        <PlanDialog
          request={request}
          onClose={() => setRequest(null)}
          onApplied={() => setItems([])}
        />
      )}
    </div>
  );
}
