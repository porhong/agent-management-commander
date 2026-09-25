import { AlertTriangle, CircleAlert, Info, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/ipc';
import type { Issue } from './draft';

const LOOK = {
  error: { Icon: CircleAlert, color: 'text-destructive' },
  warning: { Icon: AlertTriangle, color: 'text-drifted' },
  info: { Icon: Info, color: 'text-muted-foreground' },
} as const;

/** Errors shown under the field they belong to (T1.6.7). */
export function FieldIssues({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <span className="mt-1 block">
      {issues.map((issue) => {
        const look = LOOK[issue.severity];
        return (
          <span key={issue.ruleId + issue.message} className={`flex gap-1 ${look.color}`}>
            <look.Icon className="mt-0.5 size-3 shrink-0" aria-hidden />
            {issue.message}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The item's full issue list, with the rule's own fix where it offers one. A fix is an ordinary
 * manifest update, so it goes through `library.update` and is committed and versioned like any
 * other edit.
 */
export function IssuesPanel({ issues, onFixed }: { issues: Issue[]; onFixed: () => void }) {
  const update = useAction('library.update');

  if (issues.length === 0) {
    return <p className="p-4 text-muted-foreground">No issues. This item is ready to deploy.</p>;
  }

  return (
    <ul className="divide-y">
      {issues.map((issue) => {
        const look = LOOK[issue.severity];
        return (
          <li
            key={`${issue.ruleId}|${issue.path ?? ''}|${issue.message}`}
            className="flex gap-2 p-3"
          >
            <look.Icon className={`mt-0.5 size-3.5 shrink-0 ${look.color}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p>{issue.message}</p>
              <p className="id mt-0.5 text-muted-foreground">
                {issue.ruleId}
                {issue.path && ` · ${issue.path}`}
                {issue.targetId && ` · ${issue.targetId}`}
                {issue.blocking && ' · blocks deploy'}
              </p>
            </div>
            {issue.fix && (
              <Button
                size="sm"
                variant="secondary"
                disabled={update.pending}
                onClick={async () => {
                  await update.run({ id: issue.fix!.itemId, fields: issue.fix!.fields });
                  onFixed();
                }}
              >
                <Wrench className="size-3.5" aria-hidden />
                {issue.fix.label}
              </Button>
            )}
          </li>
        );
      })}
      {update.error && (
        <li role="alert" className="bg-destructive/10 p-3 text-destructive">
          {update.error.message}
        </li>
      )}
    </ul>
  );
}
