import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Download,
  Info,
  Undo2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDrift } from '@/lib/drift';
import { useQuery } from '@/lib/ipc';
import { metaOf } from '@/lib/kinds';
import { STATUS, formatDate } from '@/lib/status';

type Severity = 'error' | 'warning' | 'info';

interface Health {
  id: string;
  severity: Severity;
  headline: string;
  detail: string;
  /** What to do about it. Every health item has exactly one. */
  action: { label: string; to: string };
}

const LOOK: Record<Severity, { Icon: typeof Info; color: string }> = {
  error: { Icon: CircleAlert, color: 'text-destructive' },
  warning: { Icon: AlertTriangle, color: 'text-drifted' },
  info: { Icon: Info, color: 'text-muted-foreground' },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Where you land (T1.9.2): what is installed, what needs attention, and what changed lately.
 * Every health row names something real and links to the screen that fixes it.
 */
export function Dashboard() {
  const navigate = useNavigate();
  const status = useQuery('system.status', undefined, { on: ['library.changed'] });
  const tools = useQuery('tools.detect', undefined);
  const targets = useQuery('targets.list', undefined, { on: ['targets.changed'] });
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });
  const items = useQuery('library.list', {}, { on: ['library.changed'] });
  const validation = useQuery('library.validate', undefined, { on: ['library.changed'] });
  const history = useQuery('deploy.history', undefined, { on: ['library.changed'] });
  const incomplete = useQuery('deploy.incomplete', undefined, { on: ['library.changed'] });
  const drift = useDrift();

  const counts = status.data?.counts ?? {};
  const installed = (tools.data ?? []).filter((t) => t.installed);

  const health = useMemo<Health[]>(() => {
    const out: Health[] = [];

    const blocking = (validation.data?.issues ?? []).filter((i) => i.blocking);
    const warnings = (validation.data?.issues ?? []).filter((i) => !i.blocking && i.itemId);
    if (blocking.length > 0) {
      const first = blocking.find((i) => i.itemId);
      out.push({
        id: 'blocking',
        severity: 'error',
        headline:
          blocking.length === 1
            ? 'One problem stops a deploy'
            : `${blocking.length} problems stop a deploy`,
        detail: blocking[0]!.message,
        action: {
          label: 'Fix it',
          to: first?.itemId ? `/item/${first.itemId}?tab=issues` : '/library/skill',
        },
      });
    }

    const interrupted = incomplete.data ?? [];
    if (interrupted.length > 0) {
      out.push({
        id: 'interrupted',
        severity: 'error',
        headline:
          interrupted.length === 1
            ? 'A deploy never finished'
            : `${interrupted.length} deploys never finished`,
        detail: 'AMC can put the files back as they were, or finish writing them.',
        action: { label: 'Sort it out', to: '/history' },
      });
    }

    const drifted = (drift.data?.entries ?? []).filter((e) => e.state === 'drifted');
    if (drifted.length > 0) {
      out.push({
        id: 'drifted',
        severity: 'warning',
        headline: `${plural(drifted.length, 'file')} changed outside AMC`,
        detail:
          drifted.length === 1
            ? `${drifted[0]!.relPath} no longer matches what was deployed.`
            : `${drifted[0]!.relPath} and ${drifted.length - 1} more no longer match what was deployed.`,
        action: { label: 'Look at the difference', to: '/matrix' },
      });
    }

    const gone = (drift.data?.entries ?? []).filter((e) => e.state === 'missing');
    if (gone.length > 0) {
      out.push({
        id: 'missing-files',
        severity: 'warning',
        headline: `${plural(gone.length, 'deployed file')} ${gone.length === 1 ? 'is' : 'are'} gone`,
        detail:
          gone.length === 1
            ? `${gone[0]!.relPath} was deleted after AMC wrote it.`
            : `${gone[0]!.relPath} and ${gone.length - 1} more were deleted after AMC wrote them.`,
        action: {
          label: 'Put them back',
          to: `/deploy?items=${[...new Set(gone.map((g) => g.itemId))].join(',')}`,
        },
      });
    }

    const outdated = (matrix.data ?? []).filter((row) => row.status === 'outdated');
    if (outdated.length > 0) {
      out.push({
        id: 'outdated',
        severity: 'warning',
        headline: `${plural(outdated.length, 'deployment')} ${outdated.length === 1 ? 'is' : 'are'} behind the library`,
        detail: 'Your tools are running an older version than the one you have edited.',
        action: {
          label: 'Deploy the new version',
          to: `/deploy?items=${[...new Set(outdated.map((r) => r.itemId))].join(',')}`,
        },
      });
    }

    const orphaned = (matrix.data ?? []).filter((row) => row.status === 'missing');
    if (orphaned.length > 0) {
      out.push({
        id: 'orphaned',
        severity: 'warning',
        headline: `${plural(orphaned.length, 'deployed item')} ${orphaned.length === 1 ? 'is' : 'are'} no longer in the library`,
        detail: 'They are still installed in your tools, with nothing behind them.',
        action: { label: 'Decide what to do', to: '/matrix' },
      });
    }

    if (warnings.length > 0) {
      out.push({
        id: 'warnings',
        severity: 'info',
        headline: `${plural(warnings.length, 'item has', 'items have')} something worth a look`,
        detail: warnings[0]!.message,
        action: { label: 'Review', to: `/item/${warnings[0]!.itemId}?tab=issues` },
      });
    }

    if ((counts['items'] ?? 0) === 0) {
      out.push({
        id: 'empty',
        severity: 'info',
        headline: 'Your library is empty',
        detail: 'Import what your tools already have, or write something new.',
        action: { label: 'Import', to: '/import' },
      });
    } else if ((matrix.data ?? []).length === 0 && installed.length > 0) {
      out.push({
        id: 'nothing-deployed',
        severity: 'info',
        headline: 'Nothing is deployed yet',
        detail: 'Your tools are not using anything from the library.',
        action: { label: 'Deploy something', to: '/deploy' },
      });
    }

    return out;
  }, [validation.data, incomplete.data, drift.data, matrix.data, counts, installed.length]);

  const recentItems = useMemo(
    () =>
      [...(items.data ?? [])]
        .filter((row) => row.updatedAt)
        .sort((a, b) => (a.updatedAt! < b.updatedAt! ? 1 : -1))
        .slice(0, 5),
    [items.data],
  );
  const recentDeploys = (history.data ?? []).slice(0, 5);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          {plural(counts['items'] ?? 0, 'item')} ·{' '}
          {plural(counts['deployments'] ?? 0, 'deployment')} ·{' '}
          {plural(targets.data?.length ?? 0, 'target')}
        </p>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => navigate('/deploy')}>
          <Upload className="size-3.5" aria-hidden />
          Deploy
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/import')}>
          <Download className="size-3.5" aria-hidden />
          Import
        </Button>
      </div>

      <section className="mt-5">
        <h2 className="font-medium">Needs attention</h2>
        {health.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-in-sync">
            <CheckCircle2 className="size-4" aria-hidden />
            Everything matches: no problems, nothing outdated, nothing edited behind AMC&rsquo;s
            back.
          </p>
        ) : (
          <ul className="mt-2 max-w-4xl divide-y rounded-md border">
            {health.map((row) => {
              const look = LOOK[row.severity];
              return (
                <li key={row.id} className="flex items-start gap-3 p-3">
                  <look.Icon className={`mt-0.5 size-4 shrink-0 ${look.color}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={look.color}>{row.headline}</p>
                    <p className="text-muted-foreground">{row.detail}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => navigate(row.action.to)}>
                    {row.action.label}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {drift.data && (
          <p className="mt-1 text-muted-foreground">
            Files last checked {formatTime(drift.data.checkedAt)}.
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-medium">Your tools</h2>
        <div className="mt-2 grid max-w-4xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(tools.data ?? []).map((tool) => {
            const deployed = (matrix.data ?? []).filter((row) =>
              row.targetId.startsWith(`${tool.toolId}:`),
            ).length;
            return (
              <div key={tool.toolId} className="rounded-md border bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      tool.installed ? STATUS['in-sync'].dot : STATUS.foreign.dot
                    }`}
                  />
                  <span className="font-medium">{tool.displayName}</span>
                  {tool.version && (
                    <span className="id truncate text-muted-foreground">{tool.version}</span>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">
                  {tool.installed
                    ? deployed === 0
                      ? 'Ready, with nothing deployed yet.'
                      : `${plural(deployed, 'item')} deployed.`
                    : (tool.notes[0] ?? 'Not found on this machine.')}
                </p>
                {Object.entries(tool.roots).map(([name, dir]) => (
                  <p key={name} className="id mt-1 truncate text-muted-foreground" title={dir}>
                    {dir}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 grid max-w-4xl gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-medium">Recently edited</h2>
          {recentItems.length === 0 ? (
            <p className="mt-1 text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border">
              {recentItems.map((row) => {
                const meta = metaOf(row.id);
                return (
                  <li key={row.id} className="flex items-center gap-2 p-2">
                    <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
                    <Link to={`/item/${row.id}`} className="truncate hover:underline">
                      {row.name}
                    </Link>
                    <div className="flex-1" />
                    <span className="shrink-0 text-muted-foreground">
                      {formatDate(row.updatedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <h2 className="font-medium">Recent deploys</h2>
          {recentDeploys.length === 0 ? (
            <p className="mt-1 text-muted-foreground">Nothing deployed yet.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border">
              {recentDeploys.map((entry) => (
                <li key={entry.deployId} className="flex items-center gap-2 p-2">
                  {entry.kind === 'rollback' ? (
                    <Undo2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Upload className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <Link to="/history" className="truncate hover:underline">
                    {entry.kind === 'rollback' ? 'Reverted' : 'Deployed'}{' '}
                    {plural(entry.fileCount, 'file')}
                  </Link>
                  <div className="flex-1" />
                  <span className="shrink-0 text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(drift.data?.warnings ?? []).length > 0 && (
        <ul className="mt-6 max-w-4xl">
          {drift.data!.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-drifted">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Just the time of day: the check runs often enough that the date is never the question. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
