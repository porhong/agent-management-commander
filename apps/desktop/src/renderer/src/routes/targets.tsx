import { useState } from 'react';
import { FolderPlus, MonitorCog, Trash2 } from 'lucide-react';
import { PlanDialog, type PlanRequest } from '@/components/deploy/plan-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { call, useAction, useQuery } from '@/lib/ipc';
import { targetRefOf, type TargetRow } from '@/lib/deploy';
import { STATUS } from '@/lib/status';

/**
 * Where AMC can deploy (T1.7.1): every detected tool at global scope, plus the project folders
 * you register. Registering a folder only tells AMC it may deploy there; nothing is written
 * until a plan is applied.
 */
export function Targets() {
  const targets = useQuery('targets.list', undefined, { on: ['targets.changed'] });
  const tools = useQuery('tools.detect', undefined);
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });
  const settings = useQuery('settings.get', undefined);
  const updateSettings = useAction('settings.update');
  const addProject = useAction('targets.addProject');
  const removeProject = useAction('targets.removeProject');

  const [removing, setRemoving] = useState<TargetRow | null>(null);
  const [cleanup, setCleanup] = useState<PlanRequest | null>(null);

  const perTarget = (settings.data?.['targetSettings'] ?? {}) as Record<
    string,
    { autoApply?: string }
  >;

  const setAutoApply = async (targetId: string, value: string) => {
    await updateSettings.run({
      patch: { targetSettings: { ...perTarget, [targetId]: { autoApply: value } } },
    });
    settings.reload();
  };

  async function pickProject() {
    const picked = await call('dialog.pickFolder', { title: 'Choose a project folder' });
    if (!picked) return;
    await addProject.run({ token: picked.token });
  }

  const countFor = (targetId: string) =>
    (matrix.data ?? []).filter((row) => row.targetId === targetId).length;

  const uninstalled = (tools.data ?? []).filter((t) => !t.installed);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Targets</h1>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void pickProject()}>
          <FolderPlus className="size-3.5" aria-hidden />
          Add a project folder
        </Button>
      </div>
      <p className="mt-1 max-w-2xl text-muted-foreground">
        A target is a tool and a scope. Adding one never writes anything; it only lets you deploy
        there.
      </p>

      {addProject.error && (
        <p role="alert" className="mt-2 text-destructive">
          {addProject.error.message}
        </p>
      )}

      <ul className="mt-4 divide-y rounded-md border">
        {(targets.data ?? []).map((row) => {
          const tool = (tools.data ?? []).find((t) => t.toolId === row.toolId);
          const count = countFor(row.targetId);
          return (
            <li key={row.targetId} className="flex items-start gap-3 p-3">
              <MonitorCog className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="font-medium">{row.label}</span>
                  {tool?.version && (
                    <span className="id text-muted-foreground">{tool.version}</span>
                  )}
                  <span className="text-muted-foreground">
                    {count === 0 ? 'nothing deployed yet' : `${count} deployed`}
                  </span>
                </p>
                {Object.entries(row.roots).map(([name, dir]) => (
                  <p key={name} className="id truncate text-muted-foreground" title={dir}>
                    {Object.keys(row.roots).length > 1 && (
                      <span className="mr-1 opacity-70">{name}</span>
                    )}
                    {dir}
                  </p>
                ))}
              </div>

              <label className="flex shrink-0 items-center gap-1">
                <span className="text-muted-foreground">Applying</span>
                <select
                  aria-label={`When to apply for ${row.label}`}
                  className="h-7 rounded-sm border bg-background px-1"
                  value={perTarget[row.targetId]?.autoApply ?? 'inherit'}
                  onChange={(e) => void setAutoApply(row.targetId, e.target.value)}
                >
                  <option value="inherit">Follow settings</option>
                  <option value="ask">Always ask</option>
                  <option value="when-no-conflicts">Go ahead when nothing conflicts</option>
                </select>
              </label>

              {row.scope === 'project' && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Stop managing ${row.label}`}
                  title="Stop managing this project"
                  onClick={() => setRemoving(row)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {uninstalled.length > 0 && (
        <section className="mt-6">
          <h2 className="font-medium">Not found on this machine</h2>
          <ul className="mt-2">
            {uninstalled.map((tool) => (
              <li key={tool.toolId} className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${STATUS.foreign.dot}`} />
                <span>{tool.displayName}</span>
                <span className="text-muted-foreground">
                  {tool.notes[0] ?? 'Install it and AMC will pick it up.'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {removing && (
        <Dialog
          title={`Stop managing ${removing.label}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={countFor(removing.targetId) === 0}
                onClick={() => {
                  const target = targetRefOf(removing);
                  if (target) setCleanup({ kind: 'deploy', selections: [{ target, items: [] }] });
                }}
              >
                Remove the files too
              </Button>
              <Button
                size="sm"
                disabled={removeProject.pending}
                onClick={async () => {
                  if (removing.root && (await removeProject.run({ root: removing.root }))) {
                    setRemoving(null);
                  }
                }}
              >
                Stop managing it
              </Button>
            </>
          }
        >
          <p>
            AMC forgets this project. The files it already put there stay exactly where they are,
            and nothing else in the folder is touched.
          </p>
          <p className="mt-2 text-muted-foreground">
            {countFor(removing.targetId) === 0
              ? 'Nothing is deployed here, so there is nothing to clean up.'
              : `If you would rather remove the ${countFor(removing.targetId)} file set(s) AMC owns here, that is a plan like any other and you will see it first.`}
          </p>
          {removeProject.error && (
            <p role="alert" className="mt-2 text-destructive">
              {removeProject.error.message}
            </p>
          )}
        </Dialog>
      )}

      {cleanup && (
        <PlanDialog
          request={cleanup}
          onClose={() => setCleanup(null)}
          onApplied={async () => {
            if (removing?.root) await removeProject.run({ root: removing.root });
            setCleanup(null);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
