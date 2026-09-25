import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, Field, inputClass } from '@/components/ui/dialog';
import { useAction, useQuery } from '@/lib/ipc';
import { KINDS, type EditableKind } from '@/lib/kinds';

/** Turns a display name into the slug used for file names and slash names. */
export const toSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

/** How each kind's description is used, so the field explains why it matters (J2). */
const DESCRIPTION_HINT: Record<EditableKind, string> = {
  skill:
    'Tools read this to decide when to use the skill. Say when it applies, not what it contains.',
  agent: 'Say what this agent is for, so you and your tools know when to hand work to it.',
  command: 'Shown when you browse commands. Say what running it does.',
};

export function NewItemDialog({
  kind,
  onClose,
  onCreated,
}: {
  kind: EditableKind;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const meta = KINDS[kind] ?? KINDS.skill;
  const templates = useQuery('library.templates', undefined);
  const create = useAction('library.create');

  const [name, setName] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('');

  const forKind = (templates.data ?? []).filter((t) => t.kind === kind);
  const effectiveSlug = slugEdited ? slug : toSlug(name);
  const valid = effectiveSlug.length > 0 && description.trim().length > 0;

  async function submit() {
    const created = await create.run({
      kind,
      slug: effectiveSlug,
      name: name.trim() || effectiveSlug,
      description: description.trim(),
      ...(template && { template }),
    });
    if (created) onCreated(created.manifest['id'] as string);
  }

  return (
    <Dialog
      title={`New ${meta.label.toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid || create.pending} onClick={() => void submit()}>
            {create.pending ? 'Creating…' : `Create ${meta.label.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit();
        }}
      >
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Security Checklist"
          />
        </Field>

        <Field
          label="Slug"
          hint="Used for the file name and the name you type in a tool. It never changes on rename."
        >
          <input
            className={`${inputClass} id`}
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(toSlug(e.target.value));
            }}
            placeholder="security-checklist"
          />
        </Field>

        <Field label="Description" hint={DESCRIPTION_HINT[kind]}>
          <textarea
            className={`${inputClass} h-16 resize-none py-1`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Use when reviewing code for security issues: injection, authz, secrets."
          />
        </Field>

        {forKind.length > 0 && (
          <Field label="Start from">
            <select
              className={inputClass}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">Empty {meta.label.toLowerCase()}</option>
              {forKind.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} — {t.summary}
                </option>
              ))}
            </select>
          </Field>
        )}

        {create.error && (
          <p role="alert" className="mt-3 text-destructive">
            {create.error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}
