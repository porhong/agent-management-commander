import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { DiffView } from '@/components/editor/diff-view';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useAction, useQuery } from '@/lib/ipc';
import { formatDate } from '@/lib/status';
import { toYaml, type Draft } from './draft';
import type { EditableKind } from '@/lib/kinds';

/**
 * The library's git log for this item (T1.6.8). Restoring is an ordinary edit: it writes a new
 * commit on top rather than rewriting history, so the version you restored from is still there.
 */
export function HistoryTab({
  id,
  kind,
  current,
  onRestored,
}: {
  id: string;
  kind: EditableKind;
  current: Draft;
  onRestored: () => void;
}) {
  const history = useQuery('library.history', { id }, { on: ['library.changed'] });
  const [rev, setRev] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const at = useQuery('library.at', { id, rev: rev ?? '' }, { enabled: rev !== null });
  const restore = useAction('library.restore');

  const entries = history.data ?? [];

  return (
    <div className="flex h-full min-h-0">
      <ul className="w-80 shrink-0 overflow-y-auto border-r">
        {entries.length === 0 && (
          <li className="p-4 text-muted-foreground">
            No history yet. Every save from here on is committed to the library&rsquo;s git repo.
          </li>
        )}
        {entries.map((entry, index) => (
          <li key={entry.rev}>
            <button
              type="button"
              onClick={() => setRev(entry.rev === rev ? null : entry.rev)}
              className={`flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left ${
                entry.rev === rev ? 'bg-accent' : 'hover:bg-accent/50'
              }`}
            >
              <span className="flex w-full items-center gap-2">
                <History className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="id shrink-0 text-muted-foreground">{entry.rev.slice(0, 7)}</span>
                <span className="flex-1 text-right text-muted-foreground">
                  {formatDate(entry.timestamp)}
                </span>
              </span>
              <span className="w-full truncate">{entry.summary}</span>
              {index === 0 && <span className="text-muted-foreground">Current</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="min-w-0 flex-1 overflow-auto">
        {rev === null ? (
          <p className="p-4 text-muted-foreground">
            Pick a revision to see what changed since, and to restore it.
          </p>
        ) : at.loading && !at.data ? (
          <p className="p-4 text-muted-foreground">Loading…</p>
        ) : at.error ? (
          <p role="alert" className="p-4 text-destructive">
            {at.error.message}
          </p>
        ) : (
          at.data && (
            <>
              <div className="flex h-9 items-center gap-2 border-b px-3">
                <span className="text-muted-foreground">
                  What changed from <span className="id">{rev.slice(0, 7)}</span> to now
                </span>
                <div className="flex-1" />
                <Button size="sm" variant="secondary" onClick={() => setConfirming(rev)}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  Restore this version
                </Button>
              </div>

              <section className="border-b">
                <h3 className="bg-surface px-3 py-1 font-medium">amc.yaml</h3>
                <DiffView
                  before={toYaml(at.data.manifest, kind)}
                  after={toYaml(current.manifest, kind)}
                  emptyLabel="The manifest is unchanged."
                />
              </section>

              <section>
                <h3 className="bg-surface px-3 py-1 font-medium">Body</h3>
                <DiffView
                  before={at.data.body}
                  after={current.body}
                  emptyLabel="The body is unchanged."
                />
              </section>
            </>
          )
        )}
      </div>

      {confirming && (
        <Dialog
          title="Restore this version?"
          description="The current version is kept in history, so this can be undone."
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={restore.pending}
                onClick={async () => {
                  const restored = await restore.run({ id, rev: confirming });
                  setConfirming(null);
                  if (restored) {
                    setRev(null);
                    onRestored();
                  }
                }}
              >
                {restore.pending ? 'Restoring…' : 'Restore'}
              </Button>
            </>
          }
        >
          <p>
            The body and manifest go back to <span className="id">{confirming.slice(0, 7)}</span>,
            as a new commit with a new version number. Unsaved edits in the editor are discarded.
          </p>
          {restore.error && (
            <p role="alert" className="mt-3 text-destructive">
              {restore.error.message}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
