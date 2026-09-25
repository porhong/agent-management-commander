import type { EditableKind } from '@/lib/kinds';

/**
 * What each `amc.yaml` field is for, in the user's terms (T1.6.5).
 *
 * The generated JSON Schemas (`packages/core/schema/*.amc.json`) carry the shapes but no prose,
 * because they come from Zod. This table adds the prose and is kept in step with them by
 * `manifest-fields.test.ts`, so raw mode can suggest exactly the keys the manifest accepts.
 */
export interface FieldDoc {
  key: string;
  /** Short type summary, shown after the key in a completion. */
  type: string;
  hint: string;
  /** Fixed set of values, offered as completions after the key. */
  values?: string[];
}

const BASE: FieldDoc[] = [
  { key: 'id', type: 'kind.slug', hint: 'Stable reference. Never changes, not even on rename.' },
  { key: 'kind', type: 'skill | agent | command', hint: 'What this item is.' },
  { key: 'name', type: 'text', hint: 'Display name, shown in AMC and in some tools.' },
  { key: 'slug', type: 'lowercase-hyphens', hint: 'File name and the name you type in a tool.' },
  { key: 'version', type: 'semver', hint: 'Bumped automatically when the content changes.' },
  {
    key: 'description',
    type: 'text',
    hint: 'Tools read this to decide when to use the item. Say when it applies.',
  },
  { key: 'tags', type: 'list of text', hint: 'Your own grouping. Tools never see these.' },
  { key: 'author', type: 'text', hint: 'Who maintains it.' },
  { key: 'license', type: 'text', hint: 'SPDX id, if you share the item.' },
  { key: 'createdAt', type: 'timestamp', hint: 'Set by AMC.' },
  { key: 'updatedAt', type: 'timestamp', hint: 'Set by AMC on every save.' },
  {
    key: 'compat',
    type: 'object',
    hint: 'Per-tool escape hatch: exclude a tool, or override what it receives.',
  },
];

const PER_KIND: Record<EditableKind, FieldDoc[]> = {
  skill: [
    {
      key: 'triggers',
      type: 'list of text',
      hint: 'Extra "use this when…" hints, folded into the description a tool sees.',
    },
    { key: 'dependsOn', type: 'list of skill.*', hint: 'Skills deployed alongside this one.' },
    { key: 'allowedTools', type: 'list of permission', hint: 'Tools this skill may use.' },
    {
      key: 'scripts',
      type: 'object',
      hint: 'How far to trust bundled scripts: untrusted, reviewed, or owned.',
    },
  ],
  agent: [
    {
      key: 'model',
      type: 'object',
      hint: 'Preferred model tier, and a fallback if the tool lacks it.',
    },
    { key: 'tools', type: 'object', hint: 'allow / deny lists of permissions.' },
    {
      key: 'skills',
      type: 'list of { ref, mode }',
      hint: 'Skills this agent is equipped with, always or on demand.',
    },
    { key: 'delegatesTo', type: 'list of agent.*', hint: 'Agents this one may hand work to.' },
  ],
  command: [
    {
      key: 'arguments',
      type: 'list of { name, … }',
      hint: 'Named arguments, usable as {{name}} in the template.',
    },
    { key: 'agent', type: 'agent.*', hint: 'The agent that runs this command.' },
    {
      key: 'preloadSkills',
      type: 'list of skill.*',
      hint: 'Skills loaded before the command runs.',
    },
    { key: 'allowedTools', type: 'list of permission', hint: 'Tools this command may use.' },
  ],
};

export const fieldsFor = (kind: EditableKind): FieldDoc[] => [...BASE, ...(PER_KIND[kind] ?? [])];

/** Fields AMC owns; editing them by hand is refused or ignored on save. */
export const READ_ONLY_FIELDS = new Set(['id', 'kind', 'slug', 'createdAt', 'updatedAt']);

/**
 * The abstract permission vocabulary adapters map to native tool names. `mcp:<server>` is also
 * valid and open-ended, so it is offered as a prefix rather than a fixed value.
 */
export const PERMISSIONS: { value: string; hint: string }[] = [
  { value: 'read', hint: 'Read files' },
  { value: 'write', hint: 'Create files' },
  { value: 'edit', hint: 'Change existing files' },
  { value: 'search', hint: 'Grep and glob the workspace' },
  { value: 'shell', hint: 'Run any shell command' },
  { value: 'shell:readonly', hint: 'Run shell commands that do not change anything' },
  { value: 'web-fetch', hint: 'Fetch a URL' },
  { value: 'web-search', hint: 'Search the web' },
  { value: 'subagents', hint: 'Start other agents' },
  { value: 'todo', hint: 'Keep a task list' },
  { value: 'skills', hint: 'Invoke skills' },
];

export const MODEL_TIERS: { value: string; label: string; hint: string }[] = [
  { value: 'inherit', label: 'Inherit', hint: 'Whatever the tool is already using.' },
  { value: 'fast', label: 'Fast', hint: 'Cheapest and quickest; routine work.' },
  { value: 'balanced', label: 'Balanced', hint: 'The default for most work.' },
  { value: 'powerful', label: 'Powerful', hint: 'Hardest reasoning, slowest and dearest.' },
];
