import { Link } from 'react-router';
import { X } from 'lucide-react';
import { ChipInput } from '@/components/editor/chip-input';
import { ItemSelect } from '@/components/editor/item-select';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/ui/dialog';
import { useQuery } from '@/lib/ipc';
import { KINDS, type EditableKind } from '@/lib/kinds';
import { MODEL_TIERS, PERMISSIONS } from '@/lib/manifest-fields';
import { FieldIssues } from './issues';
import { issuesFor, type TabProps } from './draft';

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Permissions and model (T1.6.4). The values here are abstract — `read`, `shell`, `balanced` —
 * and each adapter maps them to its own names. That is what lets one item deploy to tools that
 * disagree about what a tool is called.
 */
export function ToolsTab({ draft, setManifest, issues }: TabProps) {
  const kind = String(draft.manifest['kind'] ?? 'skill') as EditableKind;
  const tools = obj(draft.manifest['tools']);
  const model = obj(draft.manifest['model']);
  const compat = obj(draft.manifest['compat']);
  const excluded = list(compat['exclude']);
  const detected = useQuery('tools.detect', undefined);

  return (
    <div className="max-w-2xl p-4">
      {kind === 'agent' ? (
        <>
          <Field label="Allowed" hint="Leave empty to inherit whatever the tool already allows.">
            <ChipInput
              value={list(tools['allow'])}
              onChange={(allow) => setManifest({ tools: { ...tools, allow } })}
              label="Allow a permission"
              placeholder="read"
              suggestions={PERMISSIONS}
            />
          </Field>

          <Field label="Denied" hint="Always applied, even where a tool would allow it by default.">
            <ChipInput
              value={list(tools['deny'])}
              onChange={(deny) => setManifest({ tools: { ...tools, deny } })}
              label="Deny a permission"
              placeholder="write"
              suggestions={PERMISSIONS}
              chipClass="bg-destructive/15 text-destructive"
            />
          </Field>
          <FieldIssues issues={issuesFor(issues, 'tools')} />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Preferred model">
              <select
                className={inputClass}
                aria-label="Preferred model"
                value={String(model['preferred'] ?? '')}
                onChange={(e) =>
                  setManifest({
                    model: e.target.value ? { ...model, preferred: e.target.value } : undefined,
                  })
                }
              >
                <option value="">Not set</option>
                {MODEL_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label} — {tier.hint}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Fallback"
              hint="Used when a tool has no equivalent of the preferred tier."
            >
              <select
                className={inputClass}
                aria-label="Fallback model"
                value={String(model['fallback'] ?? '')}
                onChange={(e) => setManifest({ model: { ...model, fallback: e.target.value } })}
              >
                <option value="">None</option>
                {MODEL_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="mt-1 text-muted-foreground">
            Tiers, not model names: each tool maps them to whatever it runs today.
          </p>
          <FieldIssues issues={issuesFor(issues, 'model')} />

          <Field label="May delegate to" hint="Agents this one is allowed to hand work to.">
            <ItemSelect
              kind="agent"
              value=""
              label="Add an agent to delegate to"
              placeholder="Choose an agent…"
              exclude={[String(draft.manifest['id']), ...list(draft.manifest['delegatesTo'])]}
              onChange={(id) =>
                id && setManifest({ delegatesTo: [...list(draft.manifest['delegatesTo']), id] })
              }
            />
            <RefList
              ids={list(draft.manifest['delegatesTo'])}
              kind="agent"
              onRemove={(id) =>
                setManifest({
                  delegatesTo: list(draft.manifest['delegatesTo']).filter((r) => r !== id),
                })
              }
            />
          </Field>
        </>
      ) : (
        <Field
          label="Allowed tools"
          hint="Leave empty to inherit. A narrower list here is never widened by a tool that allows more."
        >
          <ChipInput
            value={list(draft.manifest['allowedTools'])}
            onChange={(allowedTools) => setManifest({ allowedTools })}
            label="Allow a permission"
            placeholder="read"
            suggestions={PERMISSIONS}
          />
          <FieldIssues issues={issuesFor(issues, 'allowedTools')} />
        </Field>
      )}

      {kind === 'command' && (
        <>
          <Field label="Runs as" hint="The agent this command hands its prompt to.">
            <ItemSelect
              kind="agent"
              value={String(draft.manifest['agent'] ?? '')}
              label="Runs as"
              placeholder="No agent — runs in the current session"
              onChange={(id) => setManifest({ agent: id || undefined })}
            />
            <FieldIssues issues={issuesFor(issues, 'agent')} />
          </Field>

          <Field label="Preloaded skills" hint="Loaded before the command runs, every time.">
            <ItemSelect
              kind="skill"
              value=""
              label="Add a preloaded skill"
              placeholder="Choose a skill…"
              exclude={list(draft.manifest['preloadSkills'])}
              onChange={(id) =>
                id && setManifest({ preloadSkills: [...list(draft.manifest['preloadSkills']), id] })
              }
            />
            <RefList
              ids={list(draft.manifest['preloadSkills'])}
              kind="skill"
              onRemove={(id) =>
                setManifest({
                  preloadSkills: list(draft.manifest['preloadSkills']).filter((r) => r !== id),
                })
              }
            />
          </Field>
        </>
      )}

      {kind === 'skill' && (
        <Field
          label="Bundled scripts"
          hint="How far a tool should trust scripts shipped with this skill."
        >
          <select
            className={inputClass}
            aria-label="Bundled scripts"
            value={String(obj(draft.manifest['scripts'])['trust'] ?? 'owned')}
            onChange={(e) => setManifest({ scripts: { trust: e.target.value } })}
          >
            <option value="owned">Owned — written or reviewed by you</option>
            <option value="reviewed">Reviewed — checked once, from elsewhere</option>
            <option value="untrusted">Untrusted — do not run without asking</option>
          </select>
        </Field>
      )}

      <div className="mt-6 border-t pt-4">
        <h2 className="font-medium">Skip these tools</h2>
        <p className="mt-1 text-muted-foreground">
          An excluded tool never receives this item, and deploying to it leaves nothing behind.
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {(detected.data ?? []).map((tool) => (
            <label key={tool.toolId} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="check"
                checked={excluded.includes(tool.toolId)}
                onChange={(e) =>
                  setManifest({
                    compat: {
                      ...compat,
                      exclude: e.target.checked
                        ? [...excluded, tool.toolId]
                        : excluded.filter((t) => t !== tool.toolId),
                    },
                  })
                }
              />
              <span>{tool.displayName}</span>
              {!tool.installed && <span className="text-muted-foreground">not installed</span>}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function RefList({
  ids,
  kind,
  onRemove,
}: {
  ids: string[];
  kind: EditableKind;
  onRemove: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  const meta = KINDS[kind];
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {ids.map((id) => (
        <li key={id} className="flex items-center gap-2">
          <meta.Icon className={`size-3.5 shrink-0 ${meta.color}`} aria-hidden />
          <Link to={`/item/${id}`} className="id hover:underline">
            {id}
          </Link>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${id}`}
            onClick={() => onRemove(id)}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
