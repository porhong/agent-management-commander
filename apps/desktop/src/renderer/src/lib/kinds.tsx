import { Puzzle, Slash, UserRound, Workflow, type LucideIcon } from 'lucide-react';

/** The four item kinds, with the icons and colours fixed in docs/concept/04 §5. */
export type Kind = 'skill' | 'agent' | 'command' | 'workflow';

export interface KindMeta {
  kind: Kind;
  label: string;
  plural: string;
  Icon: LucideIcon;
  /** Tailwind text colour bound to the kind token in index.css. */
  color: string;
  /** How the item is invoked in a tool, shown before the slug. */
  sigil: string;
}

export const KINDS: Record<Kind, KindMeta> = {
  agent: {
    kind: 'agent',
    label: 'Agent',
    plural: 'Agents',
    Icon: UserRound,
    color: 'text-agent',
    sigil: '@',
  },
  skill: {
    kind: 'skill',
    label: 'Skill',
    plural: 'Skills',
    Icon: Puzzle,
    color: 'text-skill',
    sigil: '',
  },
  command: {
    kind: 'command',
    label: 'Command',
    plural: 'Commands',
    Icon: Slash,
    color: 'text-command',
    sigil: '/',
  },
  workflow: {
    kind: 'workflow',
    label: 'Workflow',
    plural: 'Workflows',
    Icon: Workflow,
    color: 'text-workflow',
    sigil: '',
  },
};

/** Kinds the library can create today; workflows arrive in Phase 2 (M2.1). */
export type EditableKind = Exclude<Kind, 'workflow'>;
export const EDITABLE_KINDS: EditableKind[] = ['agent', 'skill', 'command'];

export const kindOf = (id: string): Kind => id.slice(0, id.indexOf('.')) as Kind;
export const slugOf = (id: string): string => id.slice(id.indexOf('.') + 1);
export const metaOf = (id: string): KindMeta => KINDS[kindOf(id)] ?? KINDS.skill;

export function KindIcon({ kind, className = '' }: { kind: Kind; className?: string }) {
  const meta = KINDS[kind] ?? KINDS.skill;
  return <meta.Icon className={`${meta.color} ${className}`} aria-hidden />;
}
