import type { ModeledKind } from '../model/manifests';

/** A built-in starting point for `LibraryService.create({ template })`. */
export interface ItemTemplate {
  id: string;
  kind: ModeledKind;
  /** Shown in the "New item" picker. */
  title: string;
  summary: string;
  /** Used when the draft leaves them out. */
  description: string;
  /** Kind-specific manifest fields (e.g. `arguments`), merged under the draft's own fields. */
  fields: Record<string, unknown>;
  body: string;
}

export const ITEM_TEMPLATES: readonly ItemTemplate[] = [
  {
    id: 'blank-skill',
    kind: 'skill',
    title: 'Blank skill',
    summary: 'An empty skill.',
    description: 'Describe when an agent should use this skill.',
    fields: {},
    body: '# Instructions\n\n',
  },
  {
    id: 'checklist-skill',
    kind: 'skill',
    title: 'Checklist skill',
    summary: 'A step-by-step checklist the agent works through and reports on.',
    description: 'Use when reviewing work against a checklist. Reports each item as pass or fail.',
    fields: { triggers: ['review', 'checklist'] },
    body: [
      '# Checklist',
      '',
      'Work through every item. For each one, report **pass**, **fail**, or **n/a** with a',
      'one-line reason.',
      '',
      '- [ ] First check',
      '- [ ] Second check',
      '',
      '## Report',
      '',
      'End with a summary table of failed items and suggested fixes.',
      '',
    ].join('\n'),
  },
  {
    id: 'blank-agent',
    kind: 'agent',
    title: 'Blank agent',
    summary: 'An empty agent.',
    description: 'Describe what this agent does and when to delegate to it.',
    fields: {},
    body: 'You are a helpful specialist.\n',
  },
  {
    id: 'reviewer-agent',
    kind: 'agent',
    title: 'Reviewer agent',
    summary: 'A read-only reviewer that inspects code and reports findings.',
    description:
      'Use to review code changes for bugs, risks, and readability. Does not edit files.',
    fields: {
      model: { preferred: 'balanced' },
      tools: { allow: ['read', 'search'] },
    },
    body: [
      'You are a senior code reviewer.',
      '',
      '1. Read the changed files and their surrounding code.',
      '2. Report findings ordered by severity, each with file, line, and a concrete fix.',
      '3. Do not modify files.',
      '',
    ].join('\n'),
  },
  {
    id: 'blank-command',
    kind: 'command',
    title: 'Blank command',
    summary: 'An empty slash command.',
    description: 'Describe what this command does.',
    fields: {},
    body: '{{args}}\n',
  },
  {
    id: 'command-with-args',
    kind: 'command',
    title: 'Slash command with args',
    summary: 'A command that takes a named argument.',
    description: 'Runs a task on the given target.',
    fields: {
      arguments: [{ name: 'target', description: 'What to work on', required: true }],
    },
    body: 'Work on {{args}}.\n\nExplain what you changed when you finish.\n',
  },
];

export const findTemplate = (id: string): ItemTemplate | undefined =>
  ITEM_TEMPLATES.find((t) => t.id === id);
