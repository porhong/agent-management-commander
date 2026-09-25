import type { ModelTier } from '@amc/core';

export const ADAPTER_ID = 'claude-code';

/** Claude Code tool name → abstract AMC permission. Verified list: ../FORMAT.md §5. */
const TOOL_TO_ABSTRACT: Record<string, string> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Grep: 'search',
  Glob: 'search',
  LSP: 'search',
  Bash: 'shell',
  PowerShell: 'shell',
  WebFetch: 'web-fetch',
  WebSearch: 'web-search',
  Agent: 'subagents',
  Task: 'subagents',
  TodoWrite: 'todo',
  Skill: 'skills',
};

/** Abstract permission → Claude Code tool names (canonical direction for compile). */
const ABSTRACT_TO_TOOLS: Record<string, string[]> = {
  read: ['Read'],
  write: ['Write'],
  edit: ['Edit'],
  search: ['Grep', 'Glob'],
  shell: ['Bash'],
  'shell:readonly': ['Bash'],
  'web-fetch': ['WebFetch'],
  'web-search': ['WebSearch'],
  subagents: ['Agent'],
  todo: ['TodoWrite'],
  skills: ['Skill'],
};

/** Accepts Claude's comma/space-separated string or YAML list. `Bash(git *)` stays one token. */
export function splitToolList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  return (value.match(/[^\s,()]+(\([^)]*\))?/g) ?? []).map((t) => t.trim()).filter(Boolean);
}

export function toAbstractTools(native: string[]): string[] {
  const out = new Set<string>();
  for (const t of native) {
    const base = t.replace(/\(.*\)$/, '');
    if (base.startsWith('mcp__')) out.add(`mcp:${base.split('__')[1] ?? ''}`);
    else out.add(TOOL_TO_ABSTRACT[base] ?? `tool:${base.toLowerCase()}`);
  }
  return [...out];
}

export function toNativeTools(abstract: string[]): string[] {
  const out = new Set<string>();
  for (const a of abstract) {
    if (a.startsWith('mcp:')) out.add(`mcp__${a.slice(4)}`);
    else for (const t of ABSTRACT_TO_TOOLS[a] ?? []) out.add(t);
  }
  return [...out];
}

const MODEL_TO_TIER: Record<string, ModelTier> = {
  inherit: 'inherit',
  haiku: 'fast',
  sonnet: 'balanced',
  opus: 'powerful',
};
const TIER_TO_MODEL: Record<ModelTier, string> = {
  inherit: 'inherit',
  fast: 'haiku',
  balanced: 'sonnet',
  powerful: 'opus',
};

export const toTier = (model: string): ModelTier | undefined => MODEL_TO_TIER[model];
export const toNativeModel = (tier: ModelTier): string => TIER_TO_MODEL[tier];
