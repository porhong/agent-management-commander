import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ChannelOutput } from '../../shared/ipc-contract';

type Status = ChannelOutput<'system.status'>;
type Rows = ChannelOutput<'library.list'>;
type Targets = ChannelOutput<'targets.list'>;

/**
 * M1.5 shell: proves the IPC surface, the index, and the event bus end to end.
 * The real library UI arrives in M1.6.
 */
export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<Rows>([]);
  const [targets, setTargets] = useState<Targets>([]);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  async function refresh() {
    const [s, list, t] = await Promise.all([
      window.amc.system.status(),
      window.amc.library.list({}),
      window.amc.targets.list(),
    ]);
    if (!s.ok) return setError(`${s.error.code}: ${s.error.message}`);
    if (!list.ok) return setError(`${list.error.code}: ${list.error.message}`);
    if (!t.ok) return setError(`${t.error.code}: ${t.error.message}`);
    setStatus(s.value);
    setItems(list.value);
    setTargets(t.value);
    setError(null);
  }

  useEffect(() => {
    void refresh();
    return window.amc.on((event) => setEvents((prev) => [`${event.name}`, ...prev].slice(0, 5)));
  }, []);

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-2xl font-semibold">Agent Management Commander</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {status
          ? `${status.counts.items} items · ${status.counts.targets} targets · ${status.home}`
          : 'Starting…'}
      </p>

      <div className="mt-6 flex gap-2">
        <Button onClick={() => void refresh()}>Refresh</Button>
        <Button
          variant="secondary"
          onClick={() => void window.amc.index.rebuild().then(() => refresh())}
        >
          Rebuild index
        </Button>
      </div>

      {error && <p className="mt-4 font-mono text-sm text-destructive">{error}</p>}
      {status?.warnings.map((w) => (
        <p key={w} className="mt-2 font-mono text-sm text-muted-foreground">
          {w}
        </p>
      ))}

      <section className="mt-8 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Library
          </h2>
          <ul className="mt-2 space-y-1 font-mono text-sm">
            {items.map((i) => (
              <li key={i.id}>
                {i.id} <span className="text-muted-foreground">v{i.version}</span>
              </li>
            ))}
            {items.length === 0 && <li className="text-muted-foreground">No items yet.</li>}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Targets
          </h2>
          <ul className="mt-2 space-y-1 font-mono text-sm">
            {targets.map((t) => (
              <li key={t.targetId}>{t.label}</li>
            ))}
          </ul>
          {events.length > 0 && (
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              events: {events.join(', ')}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
