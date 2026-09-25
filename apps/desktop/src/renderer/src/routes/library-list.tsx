import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NewItemDialog } from '@/components/new-item-dialog';
import { useAction, useQuery } from '@/lib/ipc';
import { KINDS, type EditableKind } from '@/lib/kinds';
import { STATUS, formatDate, type SyncStatus } from '@/lib/status';

const ROW = 32;

/** Worst status wins, so a row with one drifted target reads as drifted. */
const WORST: SyncStatus[] = ['missing', 'drifted', 'outdated', 'in-sync'];

export function LibraryList() {
  const { kind = 'skill' } = useParams<{ kind: EditableKind }>();
  const meta = KINDS[kind] ?? KINDS.skill;
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const all = useQuery('library.list', { kind }, { on: ['library.changed'] });
  const found = useQuery(
    'library.search',
    { query },
    { enabled: query.trim().length > 0, on: ['library.changed'] },
  );
  const graph = useQuery('library.graph', undefined, { on: ['library.changed'] });
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });
  const remove = useAction('library.delete');

  useEffect(() => {
    setSelected(new Set());
    setQuery('');
    setTag(null);
  }, [kind]);

  const usedBy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of graph.data?.edges ?? []) counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
    return counts;
  }, [graph.data]);

  const deployed = useMemo(() => {
    const byItem = new Map<string, SyncStatus[]>();
    for (const row of matrix.data ?? []) {
      byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.status]);
    }
    return byItem;
  }, [matrix.data]);

  const rows = useMemo(() => {
    const base = query.trim()
      ? (found.data ?? []).filter((r) => r.kind === kind)
      : (all.data ?? []);
    return tag ? base.filter((r) => r.tags.includes(tag)) : base;
  }, [query, found.data, all.data, kind, tag]);

  const tags = useMemo(
    () => [...new Set((all.data ?? []).flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b)),
    [all.data],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const blocked = [...selected].filter((id) => (usedBy.get(id) ?? 0) > 0);
  const loading = all.loading && !all.data;

  async function deleteSelected() {
    for (const id of selected) if (!blocked.includes(id)) await remove.run({ id });
    setSelected(new Set());
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="text-lg font-semibold">{meta.plural}</h1>
        <span className="id text-muted-foreground tabular-nums">{rows.length}</span>

        <div className="relative ml-2 w-64">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${meta.plural.toLowerCase()}`}
            aria-label={`Search ${meta.plural.toLowerCase()}`}
            className="h-7 w-full rounded-sm border bg-background pl-7 pr-2 placeholder:text-muted-foreground focus-visible:border-ring"
          />
        </div>

        {tags.length > 0 && (
          <select
            value={tag ?? ''}
            onChange={(e) => setTag(e.target.value || null)}
            aria-label="Filter by tag"
            className="h-7 rounded-sm border bg-background px-2"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <div className="flex-1" />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" aria-hidden />
          New {meta.label.toLowerCase()}
        </Button>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 border-b bg-surface px-3 text-xs font-medium text-muted-foreground">
        <span className="w-5" />
        <span className="flex-1">Name</span>
        <span className="w-20 text-right">Version</span>
        <span className="w-16 text-right">Used by</span>
        <span className="w-28">Deployed</span>
        <span className="w-24 text-right">Modified</span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-3 text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            kind={kind}
            filtered={query.trim().length > 0 || tag !== null}
            onClear={() => {
              setQuery('');
              setTag(null);
            }}
            onCreate={() => setCreating(true)}
          />
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]!;
              const statuses = deployed.get(row.id) ?? [];
              const worst = WORST.find((s) => statuses.includes(s));
              return (
                <div
                  key={row.id}
                  className="absolute inset-x-0 top-0"
                  style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/item/${row.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/item/${row.id}`);
                      }
                    }}
                    className={[
                      'flex h-8 cursor-default items-center gap-3 border-b border-border/50 px-3',
                      selected.has(row.id) ? 'bg-accent' : 'hover:bg-accent/50',
                      'focus-visible:bg-accent/50',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.name}`}
                      className="check"
                    />
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
                      <span className="shrink-0 font-medium">{row.name}</span>
                      <span className="id shrink-0 text-muted-foreground">
                        {meta.sigil}
                        {row.slug}
                      </span>
                      <span className="truncate text-muted-foreground">{row.description}</span>
                    </span>
                    <span className="id w-20 text-right text-muted-foreground tabular-nums">
                      {row.version}
                    </span>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">
                      {usedBy.get(row.id) || '—'}
                    </span>
                    <span className="flex w-28 items-center gap-1">
                      {statuses.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span
                            className={`size-2 rounded-full ${STATUS[worst ?? 'in-sync'].dot}`}
                            title={STATUS[worst ?? 'in-sync'].hint}
                          />
                          <span className={STATUS[worst ?? 'in-sync'].text}>
                            {statuses.length} {statuses.length === 1 ? 'target' : 'targets'}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="w-24 text-right text-muted-foreground">
                      {formatDate(row.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex h-11 shrink-0 items-center gap-3 border-t bg-surface-raised px-3">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/deploy?items=${[...selected].join(',')}`)}
          >
            <Upload className="size-3.5" aria-hidden />
            Deploy
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={blocked.length === selected.size}
            title={
              blocked.length
                ? `${blocked.length} of these are used by other items and cannot be deleted`
                : undefined
            }
            onClick={() => void deleteSelected()}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
          {blocked.length > 0 && (
            <span className="text-muted-foreground">
              {blocked.length} {blocked.length === 1 ? 'item is' : 'items are'} used by other items
              and will be kept
            </span>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="size-3.5" aria-hidden />
            Clear
          </Button>
        </div>
      )}

      {remove.error && (
        <p role="alert" className="border-t bg-destructive/10 px-3 py-2 text-destructive">
          {remove.error.message}
        </p>
      )}

      {creating && (
        <NewItemDialog
          kind={kind}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/item/${id}`);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  kind,
  filtered,
  onClear,
  onCreate,
}: {
  kind: EditableKind;
  filtered: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  const meta = KINDS[kind] ?? KINDS.skill;
  if (filtered) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Nothing matches that search.</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }
  const blurb: Record<EditableKind, string> = {
    skill: 'A skill is a piece of knowledge or a procedure that agents can use.',
    agent: 'An agent is a specialist you can hand work to, equipped with the skills it needs.',
    command: 'A command is a prompt you trigger by name, with arguments.',
  };
  return (
    <div className="max-w-md p-6">
      <h2 className="text-lg font-semibold">No {meta.plural.toLowerCase()} yet</h2>
      <p className="mt-1 text-muted-foreground">{blurb[kind]}</p>
      <Button size="sm" className="mt-4" onClick={onCreate}>
        <Plus className="size-3.5" aria-hidden />
        New {meta.label.toLowerCase()}
      </Button>
      <p className="mt-4 text-muted-foreground">
        Already have these in Claude Code or Codex? Import brings them in without changing your
        files.
      </p>
    </div>
  );
}
