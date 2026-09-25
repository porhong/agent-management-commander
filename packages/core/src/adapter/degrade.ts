import type { ResolvedItem } from '../resolver/closure';
import { CANONICAL_PLACEHOLDER, unescapeCanonical } from './placeholders';

/**
 * Shared degradation helpers (T1.3.1). When a tool lacks a feature, adapters rewrite content
 * with these so every tool degrades the same way.
 */

/** Skills an agent must carry in its prompt: `always` skills plus their dependencies, deps first. */
export function alwaysSkills(agent: ResolvedItem): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  const seen = new Set<string>();
  const add = (s: ResolvedItem): void => {
    if (seen.has(s.item.manifest.id)) return;
    seen.add(s.item.manifest.id);
    for (const r of s.refs) if (r.relation === 'depends-on') add(r.target);
    out.push(s);
  };
  for (const r of agent.refs) if (r.relation === 'equips' && r.mode === 'always') add(r.target);
  return out;
}

/** Skills referenced with the given relation (and mode, for `equips`), in declaration order. */
export const refsOf = (
  item: ResolvedItem,
  relation: 'equips' | 'preloads' | 'depends-on',
  mode?: 'always' | 'on-demand',
): ResolvedItem[] =>
  item.refs
    .filter((r) => r.relation === relation && (mode === undefined || r.mode === mode))
    .map((r) => r.target);

/** The agent a command runs in, if any. */
export const commandAgent = (command: ResolvedItem): ResolvedItem | undefined =>
  command.refs.find((r) => r.relation === 'uses-agent')?.target;

/** Appends skill bodies to a prompt, each under its own heading. */
export function inlineSkills(body: string, skills: readonly ResolvedItem[]): string {
  if (skills.length === 0) return body;
  const blocks = skills.map((s) => `## Skill: ${s.item.manifest.name}\n\n${s.item.body.trim()}\n`);
  return `${body.trimEnd()}\n\n---\n\n${blocks.join('\n')}`;
}

/** A list of skills the model should use, e.g. for a command's preloaded skills. */
export function skillListBlock(
  heading: string,
  skills: readonly ResolvedItem[],
  invoke: (slug: string) => string,
): string {
  if (skills.length === 0) return '';
  const lines = skills.map(
    (s) => `- ${invoke(s.item.manifest.slug)}: ${s.item.manifest.description.split('\n')[0]}`,
  );
  return `${heading}\n\n${lines.join('\n')}\n`;
}

/** Position of `{{argN}}` placeholders (1-based), or undefined for named ones. */
export const positionalIndex = (name: string): number | undefined => {
  const m = /^arg([1-9]\d*)$/.exec(name);
  return m ? Number(m[1]) : undefined;
};

/**
 * Renders a canonical template. `map` turns each placeholder name into native syntax;
 * `escapeLiteral` protects literal text that the target would otherwise treat as a placeholder
 * (e.g. `$5` in Codex prompts). Escaped `\{{` becomes a literal `{{`.
 */
export function renderTemplate(
  template: string,
  map: (name: string) => string,
  escapeLiteral: (text: string) => string = (t) => t,
): string {
  let out = '';
  let last = 0;
  for (const m of template.matchAll(CANONICAL_PLACEHOLDER)) {
    out += escapeLiteral(unescapeCanonical(template.slice(last, m.index)));
    out += map(m[1]!);
    last = m.index + m[0].length;
  }
  return out + escapeLiteral(unescapeCanonical(template.slice(last)));
}
