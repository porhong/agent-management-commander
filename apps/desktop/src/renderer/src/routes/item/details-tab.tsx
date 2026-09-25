import { ChipInput } from '@/components/editor/chip-input';
import { Field, inputClass } from '@/components/ui/dialog';
import { KINDS, type EditableKind } from '@/lib/kinds';
import { FieldIssues } from './issues';
import { issuesFor, type TabProps } from './draft';

/** How each kind's description is used. The same wording as the New dialog, deliberately. */
const DESCRIPTION_HINT: Record<EditableKind, string> = {
  skill:
    'Tools read this to decide when to use the skill. Say when it applies, not what it contains.',
  agent: 'Say what this agent is for, so you and your tools know when to hand work to it.',
  command: 'Shown when you browse commands. Say what running it does.',
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export function DetailsTab({ draft, setManifest, issues }: TabProps) {
  const kind = str(draft.manifest['kind']) as EditableKind;
  const meta = KINDS[kind] ?? KINDS.skill;
  const description = str(draft.manifest['description']);

  return (
    <div className="max-w-2xl p-4">
      <Field label="Name">
        <input
          className={inputClass}
          value={str(draft.manifest['name'])}
          onChange={(e) => setManifest({ name: e.target.value })}
        />
        <FieldIssues issues={issuesFor(issues, 'name')} />
      </Field>

      <Field
        label="Slug"
        hint={`Renaming rewrites the folder and how you invoke it (${meta.sigil}${str(draft.manifest['slug'])}). The id stays the same, so nothing that references this item breaks.`}
      >
        <input
          className={`${inputClass} id`}
          value={str(draft.manifest['slug'])}
          onChange={(e) => setManifest({ slug: e.target.value })}
        />
        <FieldIssues issues={issuesFor(issues, 'slug')} />
      </Field>

      <Field label="Description" hint={DESCRIPTION_HINT[kind] ?? DESCRIPTION_HINT.skill}>
        <textarea
          className={`${inputClass} h-20 resize-y py-1`}
          value={description}
          onChange={(e) => setManifest({ description: e.target.value })}
        />
        <span className="mt-1 block text-muted-foreground tabular-nums">
          {description.length} / 1536 characters
        </span>
        <FieldIssues issues={issuesFor(issues, 'description')} />
      </Field>

      {kind === 'skill' && (
        <Field
          label="Triggers"
          hint="Extra “use this when…” phrases. Tools that only have a description get these folded into it."
        >
          <ChipInput
            value={list(draft.manifest['triggers'])}
            onChange={(triggers) => setManifest({ triggers })}
            label="Add a trigger"
            placeholder="reviewing a pull request"
          />
          <FieldIssues issues={issuesFor(issues, 'triggers')} />
        </Field>
      )}

      <Field
        label="Tags"
        hint="Your own grouping, for filtering the library. Tools never see them."
      >
        <ChipInput
          value={list(draft.manifest['tags'])}
          onChange={(tags) => setManifest({ tags })}
          label="Add a tag"
          placeholder="security"
        />
        <FieldIssues issues={issuesFor(issues, 'tags')} />
      </Field>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Author">
          <input
            className={inputClass}
            value={str(draft.manifest['author'])}
            onChange={(e) => setManifest({ author: e.target.value || undefined })}
          />
        </Field>
        <Field label="License" hint="An SPDX id, if you share this item.">
          <input
            className={inputClass}
            value={str(draft.manifest['license'])}
            onChange={(e) => setManifest({ license: e.target.value || undefined })}
            placeholder="MIT"
          />
        </Field>
      </div>
    </div>
  );
}
