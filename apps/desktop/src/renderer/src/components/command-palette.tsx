import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Command } from 'cmdk';
import { Download, Grid3x3, LayoutDashboard, MonitorCog, Plus, RefreshCw } from 'lucide-react';
import { useQuery } from '@/lib/ipc';
import { EDITABLE_KINDS, KINDS, metaOf, type EditableKind } from '@/lib/kinds';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  Icon: typeof Plus;
  run: () => void;
}

/**
 * Ctrl+K (T1.6.2): every item and every action in one place. Items come from the index, which
 * is already loaded for the sidebar, so opening is instant even with a large library.
 */
export function CommandPalette({
  open,
  onClose,
  onNewItem,
}: {
  open: boolean;
  onClose: () => void;
  onNewItem: (kind: EditableKind) => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const items = useQuery('library.list', {}, { on: ['library.changed'], enabled: open });

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  // Rebuilt each render: the list is tiny and every entry closes over current props.
  const actions: PaletteAction[] = [
    ...EDITABLE_KINDS.map((kind) => ({
      id: `new-${kind}`,
      label: `New ${KINDS[kind].label.toLowerCase()}`,
      Icon: Plus,
      run: () => {
        onClose();
        onNewItem(kind);
      },
    })),
    { id: 'go-dashboard', label: 'Go to Dashboard', Icon: LayoutDashboard, run: () => go('/') },
    { id: 'go-targets', label: 'Go to Targets', Icon: MonitorCog, run: () => go('/targets') },
    { id: 'go-matrix', label: 'Go to Matrix', Icon: Grid3x3, run: () => go('/matrix') },
    {
      id: 'go-import',
      label: 'Import from your tools',
      Icon: Download,
      run: () => go('/import'),
    },
    {
      id: 'rebuild',
      label: 'Rebuild the search index',
      hint: 'Re-reads the library from disk',
      Icon: RefreshCw,
      run: () => {
        onClose();
        void window.amc.index.rebuild();
      },
    },
  ];

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search items and actions"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <Command
        label="Search items and actions"
        className="w-full max-w-xl overflow-hidden rounded-md border bg-background shadow-lg"
        loop
      >
        <Command.Input
          value={search}
          onValueChange={setSearch}
          autoFocus
          placeholder="Search items and actions"
          className="h-10 w-full border-b bg-transparent px-3 text-base placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-muted-foreground">
            Nothing matches “{search}”.
          </Command.Empty>

          <Command.Group
            heading="Items"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {(items.data ?? []).map((row) => {
              const meta = metaOf(row.id);
              return (
                <Command.Item
                  key={row.id}
                  value={`${row.name} ${row.slug} ${row.description}`}
                  onSelect={() => go(`/item/${row.id}`)}
                  className="flex h-8 cursor-default items-center gap-2 rounded-sm px-2 data-[selected=true]:bg-accent"
                >
                  <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
                  <span className="shrink-0">{row.name}</span>
                  <span className="id shrink-0 text-muted-foreground">
                    {meta.sigil}
                    {row.slug}
                  </span>
                  <span className="truncate text-muted-foreground">{row.description}</span>
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {actions.map((action) => (
              <Command.Item
                key={action.id}
                value={action.label}
                onSelect={action.run}
                className="flex h-8 cursor-default items-center gap-2 rounded-sm px-2 data-[selected=true]:bg-accent"
              >
                <action.Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span>{action.label}</span>
                {action.hint && (
                  <span className="truncate text-muted-foreground">{action.hint}</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
