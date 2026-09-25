import { useState } from 'react';
import type { ChannelOutput } from '../../shared/ipc-contract';
import { Button } from '@/components/ui/button';

type Probe = ChannelOutput<'system.probe'>;

export function App() {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runProbe() {
    const res = await window.amc.system.probe();
    if (res.ok) setProbe(res.value);
    else setError(`${res.error.code}: ${res.error.message}`);
  }

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-2xl font-semibold">Agent Management Commander</h1>
      <p className="mt-1 text-sm text-muted-foreground">Phase 0 toolchain probe</p>

      <Button className="mt-6" onClick={() => void runProbe()}>
        Run probe
      </Button>

      {error && <p className="mt-4 font-mono text-sm text-destructive">{error}</p>}
      {probe && (
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 font-mono text-sm">
          <dt>Electron</dt>
          <dd>{probe.versions.electron}</dd>
          <dt>Node</dt>
          <dd>{probe.versions.node}</dd>
          <dt>SQLite</dt>
          <dd data-testid="sqlite-status">
            {probe.sqlite.ok
              ? `SQLite OK ${probe.sqlite.version}${probe.sqlite.fts5 ? ' (FTS5)' : ' (no FTS5)'}`
              : 'SQLite FAILED'}
          </dd>
        </dl>
      )}
    </main>
  );
}
