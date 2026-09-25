import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { AlertTriangle, Copy, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useAction, useQuery } from '@/lib/ipc';
import { KINDS, kindOf, type EditableKind } from '@/lib/kinds';
import { ArgumentsTab } from './arguments-tab';
import { BODY_LABEL, BodyPane } from './body-pane';
import { DetailsTab } from './details-tab';
import { HistoryTab } from './history-tab';
import { IssuesPanel } from './issues';
import { PreviewPane } from './preview-pane';
import { RawPane } from './raw-pane';
import { RelationsTab } from './relations-tab';
import { SkillsTab } from './skills-tab';
import { ToolsTab } from './tools-tab';
import { cloneDraft, fromYaml, isDirty, toYaml, type Draft, type Issue } from './draft';

type TabId =
  'details' | 'body' | 'skills' | 'tools' | 'arguments' | 'issues' | 'relations' | 'history';

const TABS: { id: TabId; label: string; kinds?: EditableKind[] }[] = [
  { id: 'details', label: 'Details' },
  { id: 'body', label: 'Body' },
  { id: 'skills', label: 'Skills', kinds: ['agent'] },
  { id: 'tools', label: 'Tools & model' },
  { id: 'arguments', label: 'Arguments', kinds: ['command'] },
  { id: 'issues', label: 'Issues' },
  { id: 'relations', label: 'Relations' },
  { id: 'history', label: 'History' },
];

/**
 * The item editor (T1.6.4–T1.6.8): the form on the left, and on the right the file each tool
 * will receive. Everything is one draft — form fields, raw YAML and the body all write to it —
 * so no edit is lost by switching how you look at it.
 */
export function ItemEditor() {
  const { id = '' } = useParams<{ id: string }>();
  const kind = kindOf(id) as EditableKind;
  const meta = KINDS[kind] ?? KINDS.skill;
  const navigate = useNavigate();

  const item = useQuery('library.get', { id }, { on: ['library.changed'] });
  const validation = useQuery('library.validate', undefined, { on: ['library.changed'] });
  const update = useAction('library.update');
  const rename = useAction('library.rename');
  const duplicate = useAction('library.duplicate');
  const remove = useAction('library.delete');

  // The tab and the form/YAML choice live in the URL, so a link can point at one and the back
  // button works. Only the path is guarded below, so switching tabs never asks about saving.
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'details') as TabId;
  const raw = params.get('mode') === 'yaml';
  const setTab = (next: TabId) =>
    setParams((current) => {
      const out = new URLSearchParams(current);
      out.set('tab', next);
      return out;
    });

  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);
  const [bump, setBump] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which item's manifest the YAML buffer was serialized from. */
  const seeded = useRef<string | null>(null);

  const dirty = draft !== null && saved !== null && isDirty(draft, saved);

  // Server state wins whenever there is nothing to lose, which also covers restore and rename.
  useEffect(() => {
    if (!item.data) return;
    const next: Draft = { manifest: item.data.manifest, body: item.data.body };
    setSaved((previous) => {
      setDraft((current) =>
        current && previous && isDirty(current, previous) ? current : cloneDraft(next),
      );
      return next;
    });
  }, [item.data]);

  const setRaw = (on: boolean) =>
    setParams((current) => {
      const out = new URLSearchParams(current);
      if (on) out.set('mode', 'yaml');
      else out.delete('mode');
      return out;
    });

  /**
   * Serializes the draft the first time raw mode opens for an item — from the toggle or from a
   * link straight to `?mode=yaml`. After that the YAML buffer is the user's, edits included.
   */
  useEffect(() => {
    if (!raw) {
      seeded.current = null;
      return;
    }
    if (!draft || seeded.current === id) return;
    seeded.current = id;
    setRawText(toYaml(draft.manifest, kind));
    setRawError(null);
  }, [raw, id, kind, draft]);

  const setManifest = useCallback(
    (patch: Record<string, unknown>) =>
      setDraft((current) => {
        if (!current) return current;
        const manifest = { ...current.manifest, ...patch };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === '') delete manifest[key];
        }
        return { ...current, manifest };
      }),
    [],
  );

  const setBody = useCallback(
    (body: string) => setDraft((current) => (current ? { ...current, body } : current)),
    [],
  );

  const issues = useMemo<Issue[]>(
    () => (validation.data?.issues ?? []).filter((issue) => issue.itemId === id),
    [validation.data, id],
  );
  const blocking = issues.filter((issue) => issue.blocking).length;

  // Leaving with unsaved edits asks first; the router holds the navigation until it is answered.
  const blocker = useBlocker(
    useCallback(
      ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: { pathname: string };
        nextLocation: { pathname: string };
      }) => dirty && currentLocation.pathname !== nextLocation.pathname,
      [dirty],
    ),
  );

  async function save(): Promise<boolean> {
    if (!draft || !saved) return false;
    const nextSlug = String(draft.manifest['slug'] ?? '');
    if (nextSlug && nextSlug !== String(saved.manifest['slug'] ?? '')) {
      if (!(await rename.run({ id, slug: nextSlug }))) return false;
    }
    const fields = { ...draft.manifest };
    delete fields['createdAt'];
    delete fields['updatedAt'];
    const result = await update.run({
      id,
      fields,
      body: draft.body,
      ...(bump ? { bump: bump as 'patch' | 'minor' | 'major' } : {}),
    });
    if (!result) return false;
    const next: Draft = { manifest: result.manifest, body: result.body };
    setSaved(next);
    setDraft(cloneDraft(next));
    setBump('');
    return true;
  }

  /** Raw → form: refuse the switch while the YAML cannot be read, and say why. */
  function closeRaw() {
    const parsed = fromYaml(rawText);
    if (!parsed.ok) return setRawError(parsed.message);
    setDraft((current) => (current ? { ...current, manifest: parsed.manifest } : current));
    setRawError(null);
    setRaw(false);
  }

  function onRawText(text: string) {
    setRawText(text);
    const parsed = fromYaml(text);
    setRawError(parsed.ok ? null : parsed.message);
    if (parsed.ok) {
      setDraft((current) => (current ? { ...current, manifest: parsed.manifest } : current));
    }
  }

  if (item.error) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">That item isn&rsquo;t in the library</h1>
        <p className="mt-1 text-muted-foreground">{item.error.message}</p>
        <Button size="sm" className="mt-4" onClick={() => navigate(`/library/${kind}`)}>
          Back to {meta.plural.toLowerCase()}
        </Button>
      </div>
    );
  }
  if (!draft) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const tabs = TABS.filter((t) => !t.kinds || t.kinds.includes(kind));
  const tabProps = { draft, setManifest, setBody, issues };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <meta.Icon className={`size-4 shrink-0 ${meta.color}`} aria-hidden />
        <h1 className="shrink-0 text-lg font-semibold">{String(draft.manifest['name'] ?? id)}</h1>
        <span className="id shrink-0 text-muted-foreground">{id}</span>
        <span className="id shrink-0 text-muted-foreground">
          v{String(saved?.manifest['version'] ?? '')}
        </span>
        {dirty && <span className="shrink-0 text-drifted">Unsaved changes</span>}

        <div className="flex-1" />

        <div className="flex h-7 items-center rounded-sm border p-px">
          <button
            type="button"
            onClick={closeRaw}
            className={`h-full rounded-sm px-2 ${!raw ? 'bg-accent' : 'text-muted-foreground'}`}
          >
            Form
          </button>
          <button
            type="button"
            onClick={() => setRaw(true)}
            className={`h-full rounded-sm px-2 ${raw ? 'bg-accent' : 'text-muted-foreground'}`}
          >
            YAML
          </button>
        </div>

        <select
          aria-label="Version bump"
          className="h-7 rounded-sm border bg-background px-1"
          value={bump}
          onChange={(e) => setBump(e.target.value)}
        >
          <option value="">Auto version</option>
          <option value="patch">Patch</option>
          <option value="minor">Minor</option>
          <option value="major">Major</option>
        </select>

        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={() => saved && setDraft(cloneDraft(saved))}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Revert
        </Button>
        <Button size="sm" disabled={!dirty || update.pending} onClick={() => void save()}>
          <Save className="size-3.5" aria-hidden />
          {update.pending ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => navigate(`/deploy?items=${id}`)}>
          <Upload className="size-3.5" aria-hidden />
          Deploy
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Duplicate"
          title="Duplicate"
          onClick={async () => {
            const copy = await duplicate.run({ id });
            if (copy) navigate(`/item/${String(copy.manifest['id'])}`);
          }}
        >
          <Copy className="size-3.5" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete"
          title="Delete"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </header>

      {(update.error || rename.error || remove.error) && (
        <p role="alert" className="shrink-0 border-b bg-destructive/10 px-3 py-2 text-destructive">
          {(update.error ?? rename.error ?? remove.error)?.message}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {!raw && (
            <nav className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`flex h-6 items-center gap-1 rounded-sm px-2 ${
                    tab === entry.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {entry.id === 'body' ? (BODY_LABEL[kind]?.tab ?? 'Body') : entry.label}
                  {entry.id === 'issues' && issues.length > 0 && (
                    <span
                      className={`tabular-nums ${blocking > 0 ? 'text-destructive' : 'text-drifted'}`}
                    >
                      {issues.length}
                    </span>
                  )}
                </button>
              ))}
              <div className="flex-1" />
              {blocking > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('issues')}
                  className="flex items-center gap-1 text-destructive"
                >
                  <AlertTriangle className="size-3.5" aria-hidden />
                  {blocking} {blocking === 1 ? 'issue blocks' : 'issues block'} deploying
                </button>
              )}
            </nav>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {raw ? (
              <RawPane
                kind={kind}
                yaml={rawText}
                body={draft.body}
                error={rawError}
                onYamlChange={onRawText}
                onBodyChange={setBody}
              />
            ) : tab === 'details' ? (
              <DetailsTab {...tabProps} />
            ) : tab === 'body' ? (
              <BodyPane kind={kind} body={draft.body} onChange={setBody} />
            ) : tab === 'skills' ? (
              <SkillsTab {...tabProps} />
            ) : tab === 'tools' ? (
              <ToolsTab {...tabProps} />
            ) : tab === 'arguments' ? (
              <ArgumentsTab {...tabProps} />
            ) : tab === 'issues' ? (
              <IssuesPanel issues={issues} onFixed={() => validation.reload()} />
            ) : tab === 'relations' ? (
              <RelationsTab id={id} />
            ) : (
              <HistoryTab
                id={id}
                kind={kind}
                current={draft}
                onRestored={() => {
                  setTab('details');
                  item.reload();
                }}
              />
            )}
          </div>
        </div>

        {tab !== 'history' && <PreviewPane id={id} draft={draft} dirty={dirty} />}
      </div>

      {blocker.state === 'blocked' && (
        <Dialog
          title="You have unsaved changes"
          description={`${String(draft.manifest['name'] ?? id)} has edits that are not in the library yet.`}
          onClose={() => blocker.reset?.()}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => blocker.reset?.()}>
                Keep editing
              </Button>
              <Button variant="secondary" size="sm" onClick={() => blocker.proceed?.()}>
                Discard them
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  if (await save()) blocker.proceed?.();
                }}
              >
                Save and leave
              </Button>
            </>
          }
        >
          <p>Leaving now throws the edits away. Saving commits them to the library.</p>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog
          title={`Delete ${String(draft.manifest['name'] ?? id)}?`}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={remove.pending}
                onClick={async () => {
                  if (await remove.run({ id })) navigate(`/library/${kind}`);
                  else setConfirmDelete(false);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>
            The item is removed from the library and stays in its git history. Files already
            deployed to your tools are left alone until you deploy again.
          </p>
        </Dialog>
      )}
    </div>
  );
}
