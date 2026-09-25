import { NavLink, Outlet } from 'react-router';
import {
  Download,
  Grid3x3,
  History,
  LayoutDashboard,
  MonitorCog,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@/lib/ipc';
import { EDITABLE_KINDS, KINDS } from '@/lib/kinds';

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** Kind colour for library entries; the rest stay neutral. */
  color?: string;
  count?: number;
}

function NavRow({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        [
          'group flex h-7 items-center gap-2 rounded-sm px-2 text-base',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        ].join(' ')
      }
    >
      <item.Icon className={`size-4 shrink-0 ${item.color ?? ''}`} aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {item.count !== undefined && (
        <span className="id text-muted-foreground tabular-nums">{item.count}</span>
      )}
    </NavLink>
  );
}

function Section({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="mt-5 first:mt-0">
      <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground">{label}</h2>
      <nav className="flex flex-col gap-px">
        {items.map((item) => (
          <NavRow key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}

export function AppShell({ onOpenPalette }: { onOpenPalette: () => void }) {
  const items = useQuery('library.list', {}, { on: ['library.changed'] });
  const status = useQuery('system.status', undefined, { on: ['library.changed'] });

  const countFor = (kind: string) => items.data?.filter((i) => i.kind === kind).length;

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-surface">
        <div className="flex h-11 items-center gap-2 border-b px-3">
          <span className="text-lg font-semibold tracking-tight">AMC</span>
          <span className="id text-muted-foreground">v0.1.0</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <Section
            label="Overview"
            items={[{ to: '/', label: 'Dashboard', Icon: LayoutDashboard }]}
          />
          <Section
            label="Library"
            items={EDITABLE_KINDS.map((kind) => ({
              to: `/library/${kind}`,
              label: KINDS[kind].plural,
              Icon: KINDS[kind].Icon,
              color: KINDS[kind].color,
              ...(countFor(kind) !== undefined && { count: countFor(kind) }),
            }))}
          />
          <Section
            label="Deploy"
            items={[
              { to: '/targets', label: 'Targets', Icon: MonitorCog },
              { to: '/matrix', label: 'Matrix', Icon: Grid3x3 },
              { to: '/history', label: 'History', Icon: History },
            ]}
          />
          <Section
            label="Manage"
            items={[
              { to: '/import', label: 'Import', Icon: Download },
              { to: '/settings', label: 'Settings', Icon: Settings },
            ]}
          />
        </div>

        {status.data && (
          <div className="border-t px-3 py-2" title={status.data.home}>
            <p className="id truncate text-muted-foreground">{status.data.home}</p>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
          <button
            type="button"
            onClick={onOpenPalette}
            className="flex h-7 w-full max-w-md items-center gap-2 rounded-sm border bg-background px-2 text-muted-foreground hover:border-ring/50 hover:text-foreground"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="flex-1 text-left">Search items and actions</span>
            <kbd className="id rounded-sm border px-1 text-xs">Ctrl K</kbd>
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
