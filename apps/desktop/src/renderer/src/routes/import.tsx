import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, Check, Download, Link2, Search, X } from 'lucide-react';
import { PlanDialog, type PlanRequest } from '@/components/deploy/plan-dialog';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/dialog';
import { IpcCallError, call, useQuery } from '@/lib/ipc';
import { selectionFor } from '@/lib/deploy';
import { KINDS, type EditableKind } from '@/lib/kinds';
import type { ChannelOutput } from '../../../shared/ipc-contract';

type Scan = ChannelOutput<'import.scan'>;
type Group = Scan['groups'][number];
type Adopted = ChannelOutput<'import.adopt'>;

interface Decision {
  include: boolean;
  slug: string;
  candidateId: string;
  /** Accepted suggestions, keyed `<to>|<relation>`. Nothing is accepted by default. */
  links: ReadonlySet<string>;
}

/** Why a source matched the one AMC would import from. */
const MATCH: Record<string, string> = {
  'same-content': 'identical',
  similar: 'nearly identical',
  'same-slug': 'same name, different text',
};

const RELATION_LABEL: Record<string, string> = {
  equips: 'is equipped with',
  'delegates-to': 'may delegate to',
  'uses-agent': 'runs as',
  preloads: 'preloads',
  'depends-on': 'depends on',
};

/**
 * The import wizard (T1.8.5): choose where to look → review what was found → adopt.
 *
 * Scanning and reviewing write nothing at all, and adopting writes only to the library. The
 * files in your tools are left exactly as they are; telling AMC it owns them is a separate,
 * reviewable deploy offered at the end.
 */
export function Import() {
  const targets = useQuery('targets.list', undefined, { on: ['targets.changed'] });
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label?: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [result, setResult] = useState<Adopted | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [record, setRecord] = useState<PlanRequest | null>(null);

  const rows = targets.data ?? [];
  const selected = chosen ?? new Set(rows.map((r) => r.targetId));

  useEffect(
    () =>
      window.amc.on((event) => {
        if (event.name === 'scan.progress') setProgress(event.payload as never);
      }),
    [],
  );

  const startScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setProgress(null);
    try {
      const found = await call('import.scan', { targetIds: [...selected] });
      setScan(found);
      setDecisions(
        Object.fromEntries(
          found.groups.map((group): [string, Decision] => [
            group.key,
            {
              // A clash is left out until the user renames it or decides otherwise.
              include: !group.existingId,
              slug: group.existingId ? `${group.slug}-imported` : group.slug,
              candidateId: group.canonicalId,
              links: new Set<string>(),
            },
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof IpcCallError ? err.error.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [selected]);

  const patch = (key: string, next: Partial<Decision>) =>
    setDecisions((current) => ({ ...current, [key]: { ...current[key]!, ...next } }));

  const toggleLink = (key: string, linkId: string) =>
    setDecisions((current) => {
      const links = new Set(current[key]!.links);
      if (links.has(linkId)) links.delete(linkId);
      else links.add(linkId);
      return { ...current, [key]: { ...current[key]!, links } };
    });

  const included = useMemo(
    () => (scan?.groups ?? []).filter((g) => decisions[g.key]?.include),
    [scan, decisions],
  );

  async function adopt() {
    if (!scan) return;
    setAdopting(true);
    setError(null);
    try {
      setResult(
        await call('import.adopt', {
          scanId: scan.scanId,
          items: included.map((group) => {
            const decision = decisions[group.key]!;
            return {
              key: group.key,
              slug: decision.slug,
              candidateId: decision.candidateId,
              links: [...decision.links].map((id) => {
                const [to, relation] = id.split('|') as [string, string];
                return { to, relation };
              }),
            };
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof IpcCallError ? err.error.message : String(err));
    } finally {
      setAdopting(false);
    }
  }

  const reset = () => {
    setScan(null);
    setDecisions({});
    setResult(null);
    setError(null);
    setProgress(null);
  };

  // ---------- summary ----------
  if (result) {
    return (
      <div className="h-full overflow-auto p-4">
        <h1 className="text-lg font-semibold">Imported</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          {result.created.length} {result.created.length === 1 ? 'item is' : 'items are'} in your
          library now. Your tool folders were not touched.
        </p>

        <ul className="mt-3 max-w-2xl divide-y rounded-md border">
          {result.created.map((id) => {
            const meta = KINDS[id.split('.')[0] as EditableKind] ?? KINDS.skill;
            return (
              <li key={id} className="flex items-center gap-2 p-2">
                <Check className="size-3.5 shrink-0 text-in-sync" aria-hidden />
                <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
                <Link to={`/item/${id}`} className="id hover:underline">
                  {id}
                </Link>
              </li>
            );
          })}
        </ul>

        {result.skipped.length > 0 && (
          <section className="mt-4 max-w-2xl">
            <h2 className="font-medium">Left out</h2>
            <ul className="mt-1 divide-y rounded-md border">
              {result.skipped.map((skip) => (
                <li key={skip.key} className="flex gap-2 p-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-drifted" aria-hidden />
                  <span className="id shrink-0">{skip.key}</span>
                  <span className="text-muted-foreground">{skip.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 flex max-w-2xl items-center gap-3">
          <Button
            disabled={result.targetIds.length === 0}
            onClick={() => {
              const selections = rows
                .filter((row) => result.targetIds.includes(row.targetId))
                .map((row) => selectionFor(row, [], result.created))
                .filter((s): s is NonNullable<typeof s> => s !== null);
              if (selections.length) setRecord({ kind: 'deploy', selections });
            }}
          >
            Record what is already installed
          </Button>
          <Button variant="ghost" onClick={reset}>
            Import something else
          </Button>
        </div>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          AMC does not own those files yet. Recording is an ordinary plan: where what AMC would
          write matches the file already there, nothing changes but the lockfile.
        </p>

        {record && (
          <PlanDialog request={record} onClose={() => setRecord(null)} onApplied={reset} />
        )}
      </div>
    );
  }

  // ---------- choose where to look ----------
  if (!scan) {
    return (
      <div className="h-full overflow-auto p-4">
        <h1 className="text-lg font-semibold">Import</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Bring what you already have into the library. Scanning only reads — your tool folders are
          never changed, by this or by anything else here.
        </p>

        <ul className="mt-4 max-w-2xl divide-y rounded-md border">
          {rows.length === 0 && (
            <li className="p-3 text-muted-foreground">
              No targets yet. Add one on the{' '}
              <Link to="/targets" className="underline">
                Targets
              </Link>{' '}
              screen.
            </li>
          )}
          {rows.map((row) => (
            <li key={row.targetId} className="flex items-start gap-2 p-2">
              <input
                type="checkbox"
                className="check mt-1"
                aria-label={row.label}
                checked={selected.has(row.targetId)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(row.targetId);
                  else next.delete(row.targetId);
                  setChosen(next);
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate">{row.label}</p>
                {Object.values(row.roots).map((dir) => (
                  <p key={dir} className="id truncate text-muted-foreground" title={dir}>
                    {dir}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mt-3 text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button disabled={selected.size === 0 || scanning} onClick={() => void startScan()}>
            <Search className="size-3.5" aria-hidden />
            {scanning ? 'Looking…' : 'Scan these'}
          </Button>
          {scanning && progress && (
            <span className="text-muted-foreground">
              {progress.label ?? 'Reading'} ({progress.done}/{progress.total})
            </span>
          )}
        </div>
      </div>
    );
  }

  // ---------- review ----------
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="sm" onClick={reset}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </Button>
        <h1 className="text-lg font-semibold">Review what was found</h1>
        <span className="text-muted-foreground">
          {scan.groups.length} {scan.groups.length === 1 ? 'item' : 'items'} in {scan.fileCount}{' '}
          files
        </span>
        <div className="flex-1" />
        <Button disabled={included.length === 0 || adopting} onClick={() => void adopt()}>
          <Download className="size-3.5" aria-hidden />
          {adopting ? 'Importing…' : `Import ${included.length}`}
        </Button>
      </div>

      {error && (
        <p role="alert" className="shrink-0 border-b bg-destructive/10 px-3 py-2 text-destructive">
          {error}
        </p>
      )}

      {scan.warnings.length > 0 && (
        <ul className="shrink-0 border-b bg-drifted/10 px-3 py-2">
          {scan.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-drifted">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {scan.groups.length === 0 ? (
          <p className="p-4 text-muted-foreground">
            Nothing found in those folders. If you expected something, check the paths on the
            Targets screen.
          </p>
        ) : (
          scan.groups.map((group) => (
            <GroupRow
              key={group.key}
              group={group}
              decision={decisions[group.key]!}
              onChange={(next) => patch(group.key, next)}
              onToggleLink={(linkId) => toggleLink(group.key, linkId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function GroupRow({
  group,
  decision,
  onChange,
  onToggleLink,
}: {
  group: Group;
  decision: Decision;
  onChange: (next: Partial<Decision>) => void;
  onToggleLink: (linkId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = KINDS[group.kind] ?? KINDS.skill;
  const warnings = group.sources.flatMap((s) => s.warnings);

  return (
    <section className="overflow-hidden border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="check"
          aria-label={`Import ${group.name}`}
          checked={decision.include}
          onChange={(e) => onChange({ include: e.target.checked })}
        />
        <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
        <span className="shrink-0 font-medium">{group.name}</span>
        {/* `inputClass` is full-width, so the box is sized by its wrapper rather than fighting it. */}
        <span className="w-56 shrink-0">
          <input
            className={`${inputClass} id`}
            aria-label={`Slug for ${group.name}`}
            value={decision.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{group.description}</span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {open ? 'Hide' : 'Show'} contents
        </button>
      </div>

      {group.existingId && (
        <p className="ml-6 mt-1 flex gap-2 text-drifted">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            <span className="id">{group.existingId}</span> is already in your library. Give this one
            a different slug, or leave it out.
          </span>
        </p>
      )}

      <ul className="ml-6 mt-1">
        {group.sources.map((source) => (
          <li key={source.candidateId} className="flex items-center gap-2 text-muted-foreground">
            <span className="w-40 shrink-0 truncate">{source.label}</span>
            <span className="id min-w-0 flex-1 truncate" title={source.relPath}>
              {source.relPath}
            </span>
            {group.sources.length > 1 && (
              <span className="shrink-0">
                {source.candidateId === decision.candidateId ? (
                  'taken from here'
                ) : (
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={() => onChange({ candidateId: source.candidateId })}
                  >
                    {MATCH[source.reason]} — use this one
                  </button>
                )}
              </span>
            )}
            {source.linked && <span className="shrink-0">via a link; read only</span>}
          </li>
        ))}
      </ul>

      {warnings.length > 0 && (
        <ul className="ml-6 mt-1">
          {warnings.map((warning) => (
            <li key={warning} className="flex gap-1 text-drifted">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {group.suggestions.length > 0 && (
        <div className="ml-6 mt-1">
          {group.suggestions.map((suggestion) => {
            const linkId = `${suggestion.to}|${suggestion.relation}`;
            const accepted = decision.links.has(linkId);
            return (
              <div key={linkId} className="flex items-start gap-2">
                <Link2 className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>
                    Looks like it {RELATION_LABEL[suggestion.relation] ?? suggestion.relation}{' '}
                    <span className="id">{suggestion.to}</span>
                  </p>
                  <p className="text-muted-foreground">“{suggestion.evidence}”</p>
                </div>
                <Button
                  size="sm"
                  variant={accepted ? 'secondary' : 'ghost'}
                  aria-pressed={accepted}
                  onClick={() => onToggleLink(linkId)}
                >
                  {accepted ? (
                    <>
                      <Check className="size-3.5" aria-hidden />
                      Linked
                    </>
                  ) : (
                    <>
                      <X className="size-3.5" aria-hidden />
                      Not linked
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <pre
          className="id ml-6 mt-2 max-h-64 overflow-auto rounded-sm border bg-surface p-2 whitespace-pre-wrap"
          data-selectable
        >
          {group.body}
        </pre>
      )}
    </section>
  );
}
