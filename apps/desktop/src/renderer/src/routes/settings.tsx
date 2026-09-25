import { useState } from 'react';
import { ClipboardCopy, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/dialog';
import { IpcCallError, call, useAction, useQuery } from '@/lib/ipc';

/** One row of the settings form, since every one of them writes a single key. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{hint}</p>
      </div>
      <div className="w-72 shrink-0">{children}</div>
    </div>
  );
}

export function Settings() {
  const settings = useQuery('settings.get', undefined);
  const status = useQuery('system.status', undefined);
  const update = useAction('settings.update');
  const rebuild = useAction('index.rebuild');
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [relocating, setRelocating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = settings.data ?? {};
  const set = async (patch: Record<string, unknown>) => {
    await update.run({ patch });
    settings.reload();
  };

  async function chooseLibrary() {
    setError(null);
    try {
      const picked = await call('dialog.pickFolder', { title: 'Choose a library folder' });
      if (!picked) return;
      await set({ libraryRoot: picked.path });
      setRelocating(picked.path);
    } catch (err) {
      setError(err instanceof IpcCallError ? err.error.message : String(err));
    }
  }

  return (
    <div className="h-full overflow-auto p-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="mt-4 max-w-3xl">
        <h2 className="font-medium text-muted-foreground">Appearance</h2>
        <Row label="Theme" hint="Follow the operating system, or pick one.">
          <select
            className={inputClass}
            aria-label="Theme"
            value={String(current['theme'] ?? 'system')}
            onChange={(e) => void set({ theme: e.target.value })}
          >
            <option value="system">Follow the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
      </section>

      <section className="mt-6 max-w-3xl">
        <h2 className="font-medium text-muted-foreground">Deploying</h2>
        <Row
          label="When to apply a plan"
          hint="A target can override this on the Targets screen. Conflicts and blocking issues always stop and ask."
        >
          <select
            className={inputClass}
            aria-label="When to apply a plan"
            value={String(current['autoApply'] ?? 'ask')}
            onChange={(e) => void set({ autoApply: e.target.value })}
          >
            <option value="ask">Always show me the plan</option>
            <option value="when-no-conflicts">Go ahead when nothing conflicts</option>
          </select>
        </Row>
        <Row
          label="Snapshots to keep"
          hint="Every deploy keeps a copy of what it replaced, so it can be reverted. Older ones are pruned."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={500}
              className={inputClass}
              aria-label="Snapshots to keep"
              value={Number((current['snapshots'] as { keep?: number })?.keep ?? 50)}
              onChange={(e) =>
                void set({
                  snapshots: {
                    ...(current['snapshots'] as object),
                    keep: Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                  },
                })
              }
            />
            <span className="shrink-0 text-muted-foreground">deploys</span>
          </div>
        </Row>
      </section>

      <section className="mt-6 max-w-3xl">
        <h2 className="font-medium text-muted-foreground">Library</h2>
        <Row
          label="Where the library lives"
          hint="A git repo you own. Pointing AMC at another folder never moves or deletes anything; the old library stays where it is."
        >
          <p className="id mb-1 truncate" title={status.data?.home}>
            {String(current['libraryRoot'] ?? `${status.data?.home ?? '~/.amc'}/library`)}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void chooseLibrary()}>
              Choose another
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void call('system.reveal', { what: 'library' })}
            >
              <FolderOpen className="size-3.5" aria-hidden />
              Open
            </Button>
          </div>
        </Row>

        <Row
          label="Search index"
          hint="A cache built from the library and the lockfiles. Rebuilding it changes nothing you own."
        >
          <Button
            size="sm"
            variant="secondary"
            disabled={rebuild.pending}
            onClick={() => void rebuild.run()}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {rebuild.pending ? 'Rebuilding…' : 'Rebuild it'}
          </Button>
        </Row>
      </section>

      <section className="mt-6 max-w-3xl">
        <h2 className="font-medium text-muted-foreground">Getting started</h2>
        <Row
          label="Run the welcome again"
          hint="The short tour of where things are and what is installed."
        >
          <Button size="sm" variant="secondary" onClick={() => void set({ onboarded: false })}>
            <RotateCcw className="size-3.5" aria-hidden />
            Start it
          </Button>
        </Row>
      </section>

      <section className="mt-6 max-w-3xl">
        <h2 className="font-medium text-muted-foreground">Troubleshooting</h2>
        <Row
          label="Logging"
          hint="Written to a rotating file in the AMC home. Debug is noisy but useful in a bug report."
        >
          <div className="flex gap-2">
            <select
              className={inputClass}
              aria-label="Logging"
              value={String(current['logLevel'] ?? 'info')}
              onChange={(e) => void set({ logLevel: e.target.value })}
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warnings</option>
              <option value="error">Errors only</option>
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void call('system.reveal', { what: 'logs' })}
            >
              <FolderOpen className="size-3.5" aria-hidden />
              Open
            </Button>
          </div>
        </Row>

        <Row
          label="Diagnostics"
          hint="Versions, paths, detected tools and recent warnings. Paths are shortened and secrets are removed."
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const result = await call('system.diagnostics');
              setDiagnostics(result.text);
              setCopied(false);
            }}
          >
            Show them
          </Button>
        </Row>
      </section>

      {error && (
        <p role="alert" className="mt-3 max-w-3xl text-destructive">
          {error}
        </p>
      )}
      {update.error && (
        <p role="alert" className="mt-3 max-w-3xl text-destructive">
          {update.error.message}
        </p>
      )}

      {relocating && (
        <div className="mt-4 max-w-3xl rounded-md border border-drifted/40 bg-drifted/10 p-3">
          <p className="text-drifted">AMC will use the library in this folder when it restarts.</p>
          <p className="id mt-1 truncate">{relocating}</p>
          <p className="mt-1 text-muted-foreground">
            Your previous library was left untouched where it was.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void call('system.relaunch')}>
              Restart now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRelocating(null)}>
              Later
            </Button>
          </div>
        </div>
      )}

      {diagnostics !== null && (
        <section className="mt-4 max-w-3xl">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">Diagnostics</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(diagnostics);
                setCopied(true);
              }}
            >
              <ClipboardCopy className="size-3.5" aria-hidden />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre
            className="id mt-2 max-h-80 overflow-auto rounded-md border bg-surface p-3 whitespace-pre-wrap"
            data-selectable
          >
            {diagnostics}
          </pre>
        </section>
      )}

      {(status.data?.warnings ?? []).length > 0 && (
        <ul className="mt-6 max-w-3xl">
          {status.data!.warnings.map((warning) => (
            <li key={warning} className="text-drifted">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
