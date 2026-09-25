import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { Link } from 'react-router';
import { ItemSelect } from '@/components/editor/item-select';
import { Button } from '@/components/ui/button';
import { useQuery } from '@/lib/ipc';
import { KINDS } from '@/lib/kinds';
import { FieldIssues } from './issues';
import { issuesFor, type TabProps } from './draft';

interface Equipped {
  ref: string;
  mode: 'on-demand' | 'always';
}

const read = (manifest: Record<string, unknown>): Equipped[] =>
  Array.isArray(manifest['skills'])
    ? (manifest['skills'] as Equipped[]).map((s) => ({
        ref: String(s?.ref ?? ''),
        mode: s?.mode === 'always' ? 'always' : 'on-demand',
      }))
    : [];

/**
 * An agent's skills (T1.6.4). Order matters: it is the order the skills appear in the compiled
 * prompt, so it is editable rather than alphabetical.
 */
export function SkillsTab({ draft, setManifest, issues }: TabProps) {
  const skills = read(draft.manifest);
  const catalogue = useQuery('library.list', { kind: 'skill' }, { on: ['library.changed'] });
  const nameOf = (id: string) => catalogue.data?.find((r) => r.id === id)?.name ?? id;
  const slugOf = (id: string) => catalogue.data?.find((r) => r.id === id)?.slug ?? id;

  const write = (next: Equipped[]) => setManifest({ skills: next });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= skills.length) return;
    const next = [...skills];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    write(next);
  };

  return (
    <div className="max-w-2xl p-4">
      <h2 className="font-medium">Equipped skills</h2>
      <p className="mt-1 text-muted-foreground">
        Skills are referenced, never copied. Editing a skill updates every agent that uses it, and
        deploying this agent deploys its skills too.
      </p>

      {skills.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          No skills yet. This agent gets only its own prompt.
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-md border">
          {skills.map((entry, index) => (
            <li key={entry.ref} className="flex items-center gap-2 p-2">
              <KINDS.skill.Icon className={`size-3.5 shrink-0 ${KINDS.skill.color}`} aria-hidden />
              <Link to={`/item/${entry.ref}`} className="shrink-0 font-medium hover:underline">
                {nameOf(entry.ref)}
              </Link>
              <span className="id shrink-0 text-muted-foreground">{slugOf(entry.ref)}</span>
              <div className="flex-1" />
              <select
                aria-label={`How ${nameOf(entry.ref)} is loaded`}
                className="h-6 rounded-sm border bg-background px-1"
                value={entry.mode}
                onChange={(e) =>
                  write(
                    skills.map((s, i) =>
                      i === index ? { ...s, mode: e.target.value as Equipped['mode'] } : s,
                    ),
                  )
                }
              >
                <option value="on-demand">On demand</option>
                <option value="always">Always loaded</option>
              </select>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move ${nameOf(entry.ref)} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp className="size-3.5" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move ${nameOf(entry.ref)} down`}
                disabled={index === skills.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown className="size-3.5" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${nameOf(entry.ref)}`}
                onClick={() => write(skills.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-muted-foreground">
        <span className="font-medium text-foreground">Always loaded</span> puts the skill in the
        agent&rsquo;s prompt every time.{' '}
        <span className="font-medium text-foreground">On demand</span> lets the tool pull it in when
        the description matches.
      </p>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <span className="mb-1 block font-medium">Add a skill</span>
          <ItemSelect
            kind="skill"
            value=""
            label="Add a skill"
            placeholder="Choose a skill…"
            exclude={skills.map((s) => s.ref)}
            onChange={(id) => id && write([...skills, { ref: id, mode: 'on-demand' }])}
          />
        </div>
        <Plus className="mb-2 size-3.5 text-muted-foreground" aria-hidden />
      </div>

      <FieldIssues issues={issuesFor(issues, 'skills')} />
    </div>
  );
}
