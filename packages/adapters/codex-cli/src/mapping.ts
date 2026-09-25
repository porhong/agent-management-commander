import { escapeCanonical, positionalIndex, renderTemplate, type ModelTier } from '@amc/core';

export const ADAPTER_ID = 'codex-cli';

/** Root keys: `~/.codex` (or `<project>/.codex`) and `~/.agents` (or `<project>/.agents`). */
export const CODEX_ROOT = 'codex';
export const AGENTS_ROOT = 'agents';

/**
 * Per-tool override block at `compat.overrides["codex-cli"]`: exact native values for fields AMC
 * maps lossily, plus `raw` for keys it doesn't model (FORMAT.md §7).
 */
export interface CodexOverrides {
  raw?: Record<string, unknown>;
  /** Native `name` when it isn't the slug. */
  name?: string;
  /** File name under the kind folder when it differs from `<slug>.<ext>`. */
  path?: string;
  model?: string;
  sandbox_mode?: string;
  derivedDescription?: boolean;
}

/** Tier → OpenAI model. Empty by default: the right values change often (FORMAT.md §7). */
export type ModelMap = Partial<Record<ModelTier, string>>;

// ---------- permissions ----------

export type SandboxMode = 'read-only' | 'workspace-write';

const WRITES = /^(write|edit|shell)(:(?!readonly$).*)?$/;

/**
 * Codex has one coarse switch per agent. Anything that can change files or run arbitrary shell
 * needs `workspace-write`; everything else stays `read-only`. Never `danger-full-access`.
 */
export const toSandbox = (allow: readonly string[]): SandboxMode =>
  allow.some((p) => WRITES.test(p)) ? 'workspace-write' : 'read-only';

// ---------- prompt templates ----------

/**
 * Codex prompt → canonical template: `$ARGUMENTS` → `{{args}}`, `$1`–`$9` → `{{argN}}`,
 * `$NAME` → `{{name}}`, `$$` → literal `$`.
 */
export function toCanonicalTemplate(body: string) {
  const named: string[] = [];
  const positions = new Set<number>();
  const LITERAL = '\u0000';
  const out = escapeCanonical(body.replace(/\$\$/g, LITERAL))
    .replace(/\$ARGUMENTS\b/g, '{{args}}')
    .replace(/\$([1-9])(?!\d)/g, (_m, n: string) => {
      positions.add(Number(n));
      return `{{arg${n}}}`;
    })
    .replace(/\$([A-Z][A-Z0-9_]*)\b/g, (_m, name: string) => {
      const lower = name.toLowerCase();
      if (!named.includes(lower)) named.push(lower);
      return `{{${lower}}}`;
    })
    .replace(new RegExp(LITERAL, 'g'), '$');
  return { body: out, named, positions: [...positions].sort((a, b) => a - b) };
}

/** Canonical template → Codex prompt. Escapes `$` wherever Codex would expand it. */
export function toPromptTemplate(template: string): { body: string; unmapped: string[] } {
  const unmapped: string[] = [];
  const body = renderTemplate(
    template,
    (name) => {
      if (name === 'args') return '$ARGUMENTS';
      const pos = positionalIndex(name);
      if (pos === undefined) return `$${name.toUpperCase()}`;
      if (pos <= 9) return `$${pos}`;
      unmapped.push(name);
      return '$ARGUMENTS';
    },
    (literal) => literal.replace(/\$(?=[A-Z0-9$])/g, '$$$$'),
  );
  return { body, unmapped };
}

/** Canonical template → prose, for commands compiled as skills (skills take no arguments). */
export const toSkillTemplate = (template: string): string =>
  renderTemplate(template, (name) => (name === 'args' ? "the user's request" : `<${name}>`));
