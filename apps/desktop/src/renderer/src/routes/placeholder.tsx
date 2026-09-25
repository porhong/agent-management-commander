import { Link } from 'react-router';
import { useQuery } from '@/lib/ipc';
import { STATUS } from '@/lib/status';

/**
 * Screens that arrive in later milestones. They say plainly what is not built yet rather than
 * pretending, and each one still shows the real data it will be built on.
 */
export function ComingSoon({
  title,
  milestone,
  blurb,
}: {
  title: string;
  milestone: string;
  blurb: string;
}) {
  return (
    <div className="max-w-md p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-muted-foreground">{blurb}</p>
      <p className="mt-3 text-muted-foreground">
        Not built yet — it lands in <span className="id">{milestone}</span>.
      </p>
    </div>
  );
}

export function Dashboard() {
  const status = useQuery('system.status', undefined, { on: ['library.changed'] });
  const tools = useQuery('tools.detect', undefined);
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });

  const counts = status.data?.counts ?? {};
  const drifted = (matrix.data ?? []).filter((r) => r.status !== 'in-sync');

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">
        {counts['items'] ?? 0} items across {counts['targets'] ?? 0} targets.
      </p>

      <section className="mt-6">
        <h2 className="font-medium">Your tools</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(tools.data ?? []).map((tool) => (
            <div key={tool.toolId} className="rounded-md border bg-surface p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${tool.installed ? STATUS['in-sync'].dot : STATUS.foreign.dot}`}
                />
                <span className="font-medium">{tool.displayName}</span>
                {tool.version && <span className="id text-muted-foreground">{tool.version}</span>}
              </div>
              <p className="mt-1 text-muted-foreground">
                {tool.installed ? 'Ready to receive deploys.' : 'Not found on this machine.'}
              </p>
              {Object.entries(tool.roots).map(([key, dir]) => (
                <p key={key} className="id mt-1 truncate text-muted-foreground" title={dir}>
                  {dir}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-medium">Needs attention</h2>
        {drifted.length === 0 ? (
          <p className="mt-1 text-muted-foreground">Everything deployed matches your library.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {drifted.map((row) => (
              <li key={`${row.itemId}|${row.targetId}`} className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${STATUS[row.status].dot}`} />
                <Link to={`/item/${row.itemId}`} className="id hover:underline">
                  {row.itemId}
                </Link>
                <span className="text-muted-foreground">
                  {STATUS[row.status].label.toLowerCase()} in {row.targetId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-muted-foreground">
        The full dashboard — health checks, context budget, and recent activity — lands in{' '}
        <span className="id">M1.9</span>.
      </p>
    </div>
  );
}
