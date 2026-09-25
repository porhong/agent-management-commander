import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FileX2,
  Pencil,
  TriangleAlert,
} from 'lucide-react';
import { DiffView } from '@/components/editor/diff-view';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IpcCallError, call, useQuery } from '@/lib/ipc';
import { autoApplyFor, blockingIssues, conflictsOf, realChanges } from '@/lib/deploy';
import type { Change, Plan, Selection } from '@/lib/deploy';
import type { ChannelOutput } from '../../../../shared/ipc-contract';

type Resolution = 'adopt-replace' | 'rename' | 'overwrite' | 'skip';
type Report = ChannelOutput<'deploy.apply'>;

/** What to plan. Every write in the app starts as one of these, and none skips this dialog. */
export type PlanRequest =
  | { kind: 'deploy'; selections: Selection[]; title?: string }
  | { kind: 'rollback'; deployId: string };

const OP = {
  create: { label: 'New file', Icon: FilePlus2, color: 'text-in-sync' },
  update: { label: 'Changed', Icon: Pencil, color: 'text-outdated' },
  delete: { label: 'Removed', Icon: FileX2, color: 'text-destructive' },
  conflict: { label: 'Needs a decision', Icon: TriangleAlert, color: 'text-drifted' },
  unchanged: { label: 'Unchanged', Icon: Check, color: 'text-muted-foreground' },
} as const;

/** What the plan wants to do to a conflicted path, so the choices below are not abstract. */
const PENDING: Record<string, string> = {
  create: 'AMC wants to put a file here.',
  update: 'AMC wants to write its own version here.',
  delete: 'AMC wants to remove this file.',
};

/** Why a change needs a decision, said in terms of what happened rather than rule names. */
const REASON: Record<string, string> = {
  foreign: 'This file is already there and AMC did not put it there.',
  drifted: 'The deployed file was edited outside AMC since it was last written.',
  linked: 'This path leads outside the target folder through a link.',
};

const CHOICE: Record<Resolution, { label: string; hint: string }> = {
  'adopt-replace': {
    label: 'Take it over',
    hint: 'AMC starts managing the file and replaces what is there.',
  },
  rename: {
    label: 'Keep a copy',
    hint: 'The existing file is renamed out of the way, then AMC writes its own.',
  },
  overwrite: {
    label: 'Overwrite',
    hint: 'Discard the outside edit and write the library version.',
  },
  skip: { label: 'Leave it alone', hint: 'Nothing is written to this path.' },
};

export function PlanDialog({
  request,
  onClose,
  onApplied,
}: {
  request: PlanRequest;
  onClose: () => void;
  onApplied?: (report: Report) => void;
}) {
  const settings = useQuery('settings.get', undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [applying, setApplying] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [nonce, setNonce] = useState(0);
  const autoApplied = useRef(false);

  const key = JSON.stringify(request);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setError(null);
    setResolutions({});
    const made =
      request.kind === 'rollback'
        ? call('deploy.planRollback', { deployId: request.deployId })
        : call('deploy.plan', { selections: request.selections });
    void made
      .then((result) => !cancelled && setPlan(result))
      .catch((err: unknown) => {
        if (cancelled) return;
        setError({
          message: err instanceof IpcCallError ? err.error.message : String(err),
          stale: false,
        });
      });
    return () => {
      cancelled = true;
    };
    // `key` stands in for the request, which is rebuilt on every render by its caller.
  }, [key, nonce]);

  const apply = useCallback(async () => {
    if (!plan) return;
    setApplying(true);
    try {
      const result = await call('deploy.apply', { planId: plan.planId, resolutions });
      setReport(result);
      onApplied?.(result);
    } catch (err) {
      const ipc = err instanceof IpcCallError ? err.error : null;
      setError({
        message: ipc?.message ?? String(err),
        stale: ipc?.code === 'PLAN_STALE',
      });
    } finally {
      setApplying(false);
    }
  }, [plan, resolutions, onApplied]);

  const conflicts = plan ? conflictsOf(plan) : [];
  const blocking = plan ? blockingIssues(plan) : [];
  const undecided = conflicts.filter((c) => !resolutions[c.id]);
  const changes = plan?.targets.reduce((n, t) => n + realChanges(t).length, 0) ?? 0;

  // The user's own setting, and only when there is nothing to decide (T1.7.1).
  const auto =
    plan !== null &&
    plan.targets.every((t) => autoApplyFor(settings.data, t.targetId) === 'when-no-conflicts');

  useEffect(() => {
    if (!auto || autoApplied.current || !plan) return;
    if (conflicts.length > 0 || blocking.length > 0 || changes === 0) return;
    autoApplied.current = true;
    void apply();
  }, [auto, plan, conflicts.length, blocking.length, changes, apply]);

  const title = report
    ? 'Done'
    : request.kind === 'rollback'
      ? 'Review the rollback'
      : (request.kind === 'deploy' && request.title) || 'Review the plan';

  return (
    <Dialog
      title={title}
      description={
        report
          ? undefined
          : 'Nothing is written until you apply this. Files AMC does not own are never touched.'
      }
      onClose={onClose}
      width="max-w-5xl"
      footer={
        report ? (
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            {undecided.length > 0 && (
              <span className="mr-auto text-drifted">
                {undecided.length} {undecided.length === 1 ? 'change needs' : 'changes need'} a
                decision
              </span>
            )}
            {blocking.length > 0 && (
              <span className="mr-auto text-destructive">
                Fix {blocking.length === 1 ? 'the issue' : 'the issues'} above first
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                !plan || applying || changes === 0 || undecided.length > 0 || blocking.length > 0
              }
              onClick={() => void apply()}
            >
              {applying ? 'Applying…' : `Apply ${changes} ${changes === 1 ? 'change' : 'changes'}`}
            </Button>
          </>
        )
      }
    >
      <div className="max-h-[62vh] overflow-y-auto">
        {report ? (
          <Result report={report} />
        ) : error ? (
          <div role="alert">
            <p className="flex gap-2 text-destructive">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error.stale
                ? 'Something changed on disk since this plan was made, so it was not applied.'
                : error.message}
            </p>
            {error.stale && <p className="mt-1 text-muted-foreground">{error.message}</p>}
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                setError(null);
                setNonce((n) => n + 1);
              }}
            >
              Work it out again
            </Button>
          </div>
        ) : !plan ? (
          <p className="text-muted-foreground">Working out what would change…</p>
        ) : (
          <>
            {blocking.length > 0 && (
              <ul className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2">
                {blocking.map((issue) => (
                  <li key={issue.ruleId + issue.message} className="flex gap-2 text-destructive">
                    <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span>
                      {issue.message}
                      <span className="id ml-1 opacity-70">{issue.ruleId}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {changes === 0 && (
              <p className="text-muted-foreground">
                Nothing to do — every target already matches the library.
              </p>
            )}

            {plan.targets.map((target) => (
              <section key={target.targetId} className="mb-4 last:mb-0">
                <h3 className="flex items-center gap-2 border-b pb-1">
                  <span className="font-medium">{target.label}</span>
                  {target.status === 'needs-attention' && (
                    <span className="flex items-center gap-1 text-drifted">
                      <AlertTriangle className="size-3" aria-hidden />
                      {target.message}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-muted-foreground">
                    {realChanges(target).length || 'no'}{' '}
                    {realChanges(target).length === 1 ? 'change' : 'changes'}
                  </span>
                </h3>
                {realChanges(target).map((change) => (
                  <ChangeRow
                    key={change.id}
                    change={change}
                    resolution={resolutions[change.id]}
                    onResolve={(choice) =>
                      setResolutions((current) => ({ ...current, [change.id]: choice }))
                    }
                  />
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}

function ChangeRow({
  change,
  resolution,
  onResolve,
}: {
  change: Change;
  resolution: Resolution | undefined;
  onResolve: (choice: Resolution) => void;
}) {
  const [open, setOpen] = useState(false);
  const look = OP[change.op];

  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1 text-left hover:bg-accent/40"
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <look.Icon className={`size-3.5 shrink-0 ${look.color}`} aria-hidden />
        <span className={`w-28 shrink-0 ${look.color}`}>{look.label}</span>
        <span className="id min-w-0 flex-1 truncate" title={change.relPath}>
          {change.relPath}
          {change.region && <span className="text-muted-foreground"> #{change.region}</span>}
        </span>
        <span className="id shrink-0 text-muted-foreground">{change.itemId}</span>
      </button>

      {change.op === 'conflict' && (
        <div className="mb-1 ml-8 rounded-sm border border-drifted/40 bg-drifted/10 p-2">
          <p className="text-drifted">
            {PENDING[change.pending ?? ''] ?? 'This one needs a decision.'}{' '}
            {REASON[change.reason ?? ''] ?? ''}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(change.options ?? []).map((option) => (
              <button
                key={option}
                type="button"
                title={
                  change.pending === 'delete' && option === 'overwrite'
                    ? 'Remove it anyway, discarding the outside edit.'
                    : CHOICE[option].hint
                }
                aria-pressed={resolution === option}
                onClick={() => onResolve(option)}
                className={`h-6 rounded-sm border px-2 ${
                  resolution === option
                    ? 'border-ring bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                }`}
              >
                {CHOICE[option].label}
              </button>
            ))}
          </div>
          {resolution && <p className="mt-1 text-muted-foreground">{CHOICE[resolution].hint}</p>}
        </div>
      )}

      {change.adaptations.length > 0 && (
        <ul className="mb-1 ml-8">
          {change.adaptations.map((a) => (
            <li key={a.code} className="flex gap-1 text-drifted">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {a.message}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mb-2 ml-8 rounded-sm border bg-surface">
          {change.binary ? (
            <p className="p-2 text-muted-foreground">A binary file; only its path is shown.</p>
          ) : (
            <DiffView
              before={change.before ?? ''}
              after={change.after ?? ''}
              emptyLabel="The file is identical."
            />
          )}
        </div>
      )}
    </div>
  );
}

function Result({ report }: { report: Report }) {
  const groups = [
    { label: 'Written', paths: report.written, color: 'text-in-sync' },
    { label: 'Removed', paths: report.deleted, color: 'text-destructive' },
    { label: 'Left alone', paths: report.skipped, color: 'text-muted-foreground' },
  ].filter((g) => g.paths.length > 0);

  return (
    <div>
      <p>
        Deploy <span className="id">{report.deployId}</span> finished. It can be reverted from
        History.
      </p>
      {groups.map((group) => (
        <section key={group.label} className="mt-3">
          <h3 className={`font-medium ${group.color}`}>
            {group.label} ({group.paths.length})
          </h3>
          <ul className="mt-1">
            {group.paths.map((path) => (
              <li key={path} className="id truncate text-muted-foreground" title={path}>
                {path}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
