import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, RotateCcw, Undo2 } from 'lucide-react';
import { PlanDialog, type PlanRequest } from '@/components/deploy/plan-dialog';
import { Button } from '@/components/ui/button';
import { useAction, useQuery } from '@/lib/ipc';
import { metaOf, slugOf } from '@/lib/kinds';

const OP_LABEL: Record<string, { label: string; color: string }> = {
  create: { label: 'added', color: 'text-in-sync' },
  update: { label: 'changed', color: 'text-outdated' },
  delete: { label: 'removed', color: 'text-destructive' },
};

/** `20260925T100000000Z-ab12cd` → a readable local time. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Every deploy, what it changed, and a way back (T1.7.5). Reverting is planned and reviewed
 * like any other write, so it is never a surprise either.
 */
export function DeployHistory() {
  const history = useQuery('deploy.history', undefined, { on: ['library.changed'] });
  const incomplete = useQuery('deploy.incomplete', undefined, { on: ['library.changed'] });
  const recover = useAction('deploy.recover');

  const [selected, setSelected] = useState<string | null>(null);
  const [request, setRequest] = useState<PlanRequest | null>(null);
  const report = useQuery(
    'deploy.report',
    { deployId: selected ?? '' },
    { enabled: selected !== null },
  );

  const entries = history.data ?? [];
  const reverted = new Set(entries.map((e) => e.revertsDeployId).filter(Boolean));

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-96 shrink-0 flex-col border-r">
        <div className="flex h-11 shrink-0 items-center border-b px-3">
          <h1 className="text-lg font-semibold">Deploy history</h1>
        </div>

        {(incomplete.data ?? []).length > 0 && (
          <div className="border-b bg-drifted/10 p-3">
            <p className="flex gap-2 text-drifted">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {incomplete.data!.length === 1
                ? 'A deploy was interrupted and never finished.'
                : `${incomplete.data!.length} deploys were interrupted and never finished.`}
            </p>
            {incomplete.data!.map((job) => (
              <div key={job.deployId} className="mt-2 flex items-center gap-2">
                <span className="id flex-1 truncate">{job.deployId}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={recover.pending}
                  onClick={() =>
                    void recover.run({ deployId: job.deployId, mode: 'rollback' }).then(() => {
                      incomplete.reload();
                      history.reload();
                    })
                  }
                >
                  Put it back
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={recover.pending}
                  onClick={() =>
                    void recover.run({ deployId: job.deployId, mode: 'complete' }).then(() => {
                      incomplete.reload();
                      history.reload();
                    })
                  }
                >
                  Finish it
                </Button>
              </div>
            ))}
            {recover.error && (
              <p role="alert" className="mt-1 text-destructive">
                {recover.error.message}
              </p>
            )}
          </div>
        )}

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entries.length === 0 && (
            <li className="p-4 text-muted-foreground">
              Nothing deployed yet. Once you do, every deploy is listed here with a way back.
            </li>
          )}
          {entries.map((entry) => (
            <li key={entry.deployId}>
              <button
                type="button"
                onClick={() => setSelected(entry.deployId)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left ${
                  entry.deployId === selected ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  {entry.kind === 'rollback' && (
                    <Undo2 className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="font-medium">
                    {entry.kind === 'rollback' ? 'Reverted' : 'Deployed'} {entry.fileCount}{' '}
                    {entry.fileCount === 1 ? 'file' : 'files'}
                  </span>
                  <span className="flex-1 text-right text-muted-foreground">
                    {when(entry.createdAt)}
                  </span>
                </span>
                <span className="id truncate text-muted-foreground">{entry.deployId}</span>
                {reverted.has(entry.deployId) && (
                  <span className="text-muted-foreground">Already reverted</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 flex-1 overflow-auto">
        {selected === null ? (
          <p className="p-4 text-muted-foreground">
            Pick a deploy to see the files it touched, and to revert it.
          </p>
        ) : report.error ? (
          <p role="alert" className="p-4 text-destructive">
            {report.error.message}
          </p>
        ) : !report.data ? (
          <p className="p-4 text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex h-11 items-center gap-2 border-b px-3">
              <span className="id">{report.data.deployId}</span>
              <span className="text-muted-foreground">{when(report.data.createdAt)}</span>
              {report.data.revertsDeployId && (
                <span className="text-muted-foreground">
                  reverts <span className="id">{report.data.revertsDeployId}</span>
                </span>
              )}
              <div className="flex-1" />
              <Button
                size="sm"
                variant="secondary"
                disabled={reverted.has(selected)}
                title={
                  reverted.has(selected) ? 'This deploy has already been reverted.' : undefined
                }
                onClick={() => setRequest({ kind: 'rollback', deployId: selected })}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Revert this deploy
              </Button>
            </div>

            {report.data.targets.length === 0 ? (
              <p className="p-4 text-muted-foreground">This deploy wrote no files of its own.</p>
            ) : (
              report.data.targets.map((target) => (
                <section key={target.targetId} className="p-3">
                  <h2 className="id font-medium">{target.targetId}</h2>
                  <ul className="mt-1 divide-y">
                    {target.files.map((file) => {
                      const op = OP_LABEL[file.op]!;
                      return (
                        <li
                          key={`${file.root}/${file.relPath}${file.region ?? ''}`}
                          className="flex items-center gap-2 py-1"
                        >
                          <span className={`w-16 shrink-0 ${op.color}`}>{op.label}</span>
                          <span className="id min-w-0 flex-1 truncate" title={file.relPath}>
                            {file.relPath}
                            {file.region && (
                              <span className="text-muted-foreground"> #{file.region}</span>
                            )}
                          </span>
                          {file.itemId && (
                            <Link
                              to={`/item/${file.itemId}`}
                              className="id shrink-0 text-muted-foreground hover:underline"
                            >
                              {metaOf(file.itemId).sigil}
                              {slugOf(file.itemId)}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}

            <p className="px-3 pb-4 text-muted-foreground">
              Adaptations are shown while planning, before anything is written; what is recorded
              here is the files a deploy touched.
            </p>
          </>
        )}
      </div>

      {request && (
        <PlanDialog
          request={request}
          onClose={() => setRequest(null)}
          // The dialog stays open on its report; closing it is the user's move, as everywhere else.
          onApplied={() => {
            history.reload();
            incomplete.reload();
          }}
        />
      )}
    </div>
  );
}
