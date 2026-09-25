import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PlanDialog, type PlanRequest } from '@/components/deploy/plan-dialog';
import { useDrift } from '@/lib/drift';
import { useQuery } from '@/lib/ipc';
import { selectionFor } from '@/lib/deploy';
import { metaOf, slugOf } from '@/lib/kinds';
import { STATUS, type SyncStatus } from '@/lib/status';

const ROW = 28;
const COL = 148;

/**
 * Items × targets (T1.7.4). One index query feeds the whole grid, and clicking a cell opens the
 * plan that would make it true — adding the item to that target, or retiring it from there.
 */
export function Matrix() {
  const items = useQuery('library.list', {}, { on: ['library.changed'] });
  const targets = useQuery('targets.list', undefined, { on: ['targets.changed'] });
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });
  const drift = useDrift();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState<PlanRequest | null>(null);

  const columns = targets.data ?? [];

  const cells = useMemo(() => {
    const map = new Map<string, SyncStatus>();
    for (const row of matrix.data ?? []) map.set(`${row.itemId}|${row.targetId}`, row.status);
    // What is on disk beats what the version numbers say: a file edited or deleted behind AMC
    // is the more urgent truth, whichever version it claims to be (T1.9.3).
    for (const entry of drift.data?.entries ?? []) {
      const key = `${entry.itemId}|${entry.targetId}`;
      if (map.has(key)) map.set(key, entry.state === 'missing' ? 'missing' : 'drifted');
    }
    return map;
  }, [matrix.data, drift.data]);

  // An item deployed somewhere but no longer in the library still needs a row, or its files
  // would be invisible here — and those are exactly the ones worth cleaning up.
  const rows = useMemo(() => {
    const known = new Set((items.data ?? []).map((r) => r.id));
    const orphans = [...new Set((matrix.data ?? []).map((r) => r.itemId))]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: slugOf(id), inLibrary: false }));
    return [
      ...(items.data ?? []).map((r) => ({ id: r.id, name: r.name, inLibrary: true })),
      ...orphans,
    ];
  }, [items.data, matrix.data]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  function toggle(itemId: string, targetId: string, deployed: boolean) {
    const row = columns.find((c) => c.targetId === targetId);
    if (!row) return;
    const selection = selectionFor(
      row,
      matrix.data ?? [],
      deployed ? [] : [itemId],
      deployed ? [itemId] : [],
    );
    if (selection) {
      setRequest({
        kind: 'deploy',
        selections: [selection],
        title: deployed ? `Remove ${slugOf(itemId)} from ${row.label}` : `Deploy to ${row.label}`,
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="text-lg font-semibold">Matrix</h1>
        <span className="text-muted-foreground">
          What is installed where. Click a cell to change it.
        </span>
      </div>

      <div className="flex h-7 shrink-0 items-center border-b bg-surface px-3 text-xs font-medium text-muted-foreground">
        <span className="w-64 shrink-0">Item</span>
        {columns.map((column) => (
          <span
            key={column.targetId}
            className="shrink-0 truncate px-1"
            style={{ width: COL }}
            title={column.root ?? column.label}
          >
            {column.label}
          </span>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {columns.length === 0 ? (
          <p className="p-4 text-muted-foreground">
            No targets yet. Add one on the{' '}
            <Link to="/targets" className="underline">
              Targets
            </Link>{' '}
            screen.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-muted-foreground">The library is empty.</p>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index]!;
              const meta = metaOf(row.id);
              return (
                <div
                  key={row.id}
                  className="absolute inset-x-0 top-0 flex items-center border-b border-border/50 px-3"
                  style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                >
                  <span className="flex w-64 shrink-0 items-center gap-2">
                    <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
                    {row.inLibrary ? (
                      <Link to={`/item/${row.id}`} className="truncate hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      <span
                        className="truncate text-muted-foreground"
                        title="No longer in the library"
                      >
                        {row.name}
                      </span>
                    )}
                  </span>
                  {columns.map((column) => {
                    const status = cells.get(`${row.id}|${column.targetId}`) ?? 'not-deployed';
                    const deployed = status !== 'not-deployed';
                    const look = STATUS[status];
                    return (
                      <button
                        key={column.targetId}
                        type="button"
                        style={{ width: COL }}
                        title={`${look.label}. ${look.hint}`}
                        aria-label={`${row.name} in ${column.label}: ${look.label}`}
                        onClick={() => toggle(row.id, column.targetId, deployed)}
                        className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1 hover:bg-accent"
                      >
                        <span className={`size-2 shrink-0 rounded-full ${look.dot}`} />
                        <span className={`truncate ${look.text}`}>{look.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {request && <PlanDialog request={request} onClose={() => setRequest(null)} />}
    </div>
  );
}
