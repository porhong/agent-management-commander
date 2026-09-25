import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, GitCompareArrows } from 'lucide-react';
import { DiffView } from '@/components/editor/diff-view';
import { Button } from '@/components/ui/button';
import { IpcCallError, call, useQuery } from '@/lib/ipc';
import { STATUS } from '@/lib/status';
import { estimateTokens, type Draft } from './draft';
import type { ChannelOutput } from '../../../../shared/ipc-contract';

type Compiled = ChannelOutput<'compile.preview'>['files'][number];

/** Long enough that typing doesn't thrash the compiler, short enough to feel live (T1.6.6). */
const DEBOUNCE_MS = 300;

/**
 * The compiled preview: exactly the bytes each tool receives.
 *
 * This is the pane the product is about — one item, written once, shown as the file each tool
 * actually gets — so it carries the visual weight while the form stays quiet. It compiles the
 * *draft*, not the saved item, so what you see matches what you are typing.
 */
export function PreviewPane({ id, draft, dirty }: { id: string; draft: Draft; dirty: boolean }) {
  const tools = useQuery('tools.detect', undefined);
  const targets = useQuery('targets.list', undefined, { on: ['targets.changed'] });
  const matrix = useQuery('deploy.matrix', undefined, { on: ['library.changed'] });

  const [toolId, setToolId] = useState<string>('');
  const [files, setFiles] = useState<Compiled[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [deployed, setDeployed] = useState<Record<string, string | null> | null>(null);

  /**
   * Every tool AMC can deploy to, not only the ones found on this machine. The deploy screen
   * offers all of them — a tool you have not installed yet still has a folder AMC would write
   * to — so refusing to show what it would receive was just an inconsistency.
   */
  const available = tools.data ?? [];
  const current = toolId || available[0]?.toolId || '';
  const excluded = (
    Array.isArray((draft.manifest['compat'] as { exclude?: unknown })?.exclude)
      ? ((draft.manifest['compat'] as { exclude: unknown[] }).exclude as string[])
      : []
  ).includes(current);

  const key = `${current}|${JSON.stringify(draft.manifest)}|${draft.body}`;

  useEffect(() => {
    if (!current || excluded) return setFiles([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      call('compile.preview', {
        id,
        target: { toolId: current, scope: 'global' },
        draft: { manifest: draft.manifest, body: draft.body },
      })
        .then((result) => {
          if (cancelled) return;
          setFiles(result.files);
          setError(null);
          setActive((index) => (index < result.files.length ? index : 0));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setFiles([]);
          setError(err instanceof IpcCallError ? err.error.message : String(err));
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` covers every input; listing the objects instead would recompile on equal drafts.
  }, [key, id, excluded]);

  // A new compile invalidates whatever was fetched to compare against.
  useEffect(() => {
    setDeployed(null);
    setComparing(false);
  }, [current, id]);

  const file = files[active];
  const target = (targets.data ?? []).find((t) => t.toolId === current && t.scope === 'global');
  const root = file && target ? target.roots[file.root] : undefined;
  const status = (matrix.data ?? []).find(
    (row) => row.itemId === id && row.targetId === `${current}:global`,
  );
  const adaptations = files.flatMap((f) => f.adaptations);

  /** Compares against what is installed, by planning a deploy of this one item and reading it. */
  async function compare() {
    setComparing(true);
    try {
      const plan = await call('deploy.plan', {
        selections: [{ target: { toolId: current, scope: 'global' }, items: [id] }],
      });
      const byPath: Record<string, string | null> = {};
      for (const t of plan.targets) {
        for (const change of t.changes) byPath[`${change.root}/${change.relPath}`] = change.before;
      }
      setDeployed(byPath);
    } catch (err) {
      setError(err instanceof IpcCallError ? err.error.message : String(err));
      setComparing(false);
    }
  }

  return (
    <aside className="flex min-h-0 w-[46%] shrink-0 flex-col border-l bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <span className="mr-1 font-medium">Preview</span>
        {available.map((tool) => (
          <button
            key={tool.toolId}
            type="button"
            onClick={() => setToolId(tool.toolId)}
            title={
              tool.installed ? undefined : `${tool.displayName} was not found on this machine.`
            }
            className={`h-6 rounded-sm px-2 ${
              tool.toolId === current
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tool.displayName}
            {!tool.installed && <span className="ml-1 opacity-60">·</span>}
          </button>
        ))}
        <div className="flex-1" />
        {status && (
          <span className="flex items-center gap-1" title={STATUS[status.status].hint}>
            <span className={`size-2 rounded-full ${STATUS[status.status].dot}`} />
            <span className={STATUS[status.status].text}>{STATUS[status.status].label}</span>
          </span>
        )}
      </div>

      {available.length === 0 ? (
        <p className="p-4 text-muted-foreground">
          No tools to compile for. AMC supports Claude Code and Codex CLI so far.
        </p>
      ) : excluded ? (
        <p className="p-4 text-muted-foreground">
          This item is set to skip this tool, so it receives nothing.
        </p>
      ) : error ? (
        <div className="p-4">
          <p className="flex gap-2 text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
          <p className="mt-2 text-muted-foreground">
            The preview compiles the manifest as you type, so this usually means a field is not
            valid yet.
          </p>
        </div>
      ) : files.length === 0 ? (
        <p className="p-4 text-muted-foreground">Compiling…</p>
      ) : (
        <>
          {files.length > 1 && (
            <div className="flex h-7 shrink-0 items-center gap-1 border-b px-2">
              {files.map((f, index) => (
                <button
                  key={`${f.root}/${f.relPath}`}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`id h-5 rounded-sm px-1.5 ${
                    index === active ? 'bg-accent' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.relPath.split('/').at(-1)}
                </button>
              ))}
            </div>
          )}

          {adaptations.length > 0 && (
            <ul className="shrink-0 border-b bg-drifted/10 px-3 py-2">
              {adaptations.map((a) => (
                <li key={a.code} className="flex gap-2 text-drifted">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>{a.message}</span>
                </li>
              ))}
            </ul>
          )}

          {file && (
            <>
              <div className="flex shrink-0 items-baseline gap-2 border-b bg-surface-raised px-3 py-1.5">
                <FileText
                  className="size-3.5 shrink-0 self-center text-muted-foreground"
                  aria-hidden
                />
                <span
                  className="id truncate"
                  title={root ? `${root}/${file.relPath}` : file.relPath}
                >
                  {file.relPath}
                </span>
                <div className="flex-1" />
                <span className="text-muted-foreground tabular-nums">
                  ~{estimateTokens(file.content).toLocaleString()} tokens
                </span>
              </div>
              {root && (
                <p className="id shrink-0 truncate border-b px-3 py-1 text-muted-foreground">
                  {root}
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-auto bg-background">
                {deployed ? (
                  <DiffView
                    before={deployed[`${file.root}/${file.relPath}`] ?? ''}
                    after={file.content}
                    emptyLabel="This file is already exactly what is installed."
                  />
                ) : file.binary ? (
                  <p className="p-3 text-muted-foreground">
                    A binary file, shown only as its path.
                  </p>
                ) : (
                  <pre className="id whitespace-pre-wrap break-words p-3" data-selectable>
                    {file.content}
                  </pre>
                )}
              </div>
            </>
          )}

          <div className="flex h-8 shrink-0 items-center gap-2 border-t px-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={dirty || comparing}
              title={dirty ? 'Save first: the comparison is made from the saved item.' : undefined}
              onClick={() => (deployed ? setDeployed(null) : void compare())}
            >
              <GitCompareArrows className="size-3.5" aria-hidden />
              {deployed ? 'Show the file' : 'Compare with what is installed'}
            </Button>
            {dirty && <span className="text-muted-foreground">Unsaved — preview only</span>}
          </div>
        </>
      )}
    </aside>
  );
}
