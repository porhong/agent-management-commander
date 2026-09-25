import {
  commandAgent,
  positionalIndex,
  refsOf,
  renderTemplate,
  skillListBlock,
  stringifyFrontmatter,
  type Adaptation,
  type CompiledFile,
  type ResolvedItem,
  type Target,
} from '@amc/core';
import { ADAPTER_ID, toNativeModel, toNativeTools } from './mapping';
import type { ClaudeOverrides } from './parse';

/** Key of the single root a Claude Code target writes into (`~/.claude` or `<project>/.claude`). */
export const ROOT = 'claude';

const joinTools = (abstract: string[] | undefined) =>
  abstract ? toNativeTools(abstract).join(', ') : undefined;

const overridesOf = (r: ResolvedItem) =>
  (r.item.manifest.compat?.overrides[ADAPTER_ID] ?? {}) as ClaudeOverrides;

/** The name Claude Code knows an item by: its frontmatter `name` (agents) or folder (skills). */
const nativeName = (r: ResolvedItem) =>
  r.item.manifest.kind === 'agent'
    ? (overridesOf(r).name ?? r.item.manifest.slug)
    : r.item.manifest.slug;

function render(data: Record<string, unknown>, body: string): string {
  const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  // A file with nothing to put in frontmatter is emitted as plain Markdown.
  return Object.keys(defined).length ? stringifyFrontmatter(defined, body) : body;
}

/** Canonical item → Claude Code files. Pure: no I/O, deterministic output. */
export function compileItem(resolved: ResolvedItem, _target?: Target): CompiledFile[] {
  const { item } = resolved;
  const m = item.manifest;
  const o = overridesOf(resolved);
  const adaptations: Adaptation[] = [];
  const description = o.derivedDescription ? undefined : m.description;
  const out = (relPath: string, content: string | Buffer): CompiledFile => ({
    root: ROOT,
    relPath,
    content,
    itemId: m.id,
    adaptations,
  });

  if (m.kind === 'agent') {
    const always = refsOf(resolved, 'equips', 'always').map(nativeName);
    let body = item.body;
    const delegates = resolved.refs
      .filter((r) => r.relation === 'delegates-to')
      .map((r) => r.target);
    if (delegates.length) {
      adaptations.push({
        code: 'agent.delegates.prompt',
        message:
          'Claude Code has no delegation list; the allowed subagents are listed in the prompt.',
      });
      const list = delegates.map(
        (d) => `- ${nativeName(d)}: ${d.item.manifest.description.split('\n')[0]}`,
      );
      body = `${body.trimEnd()}\n\n## Subagents you may delegate to\n\n${list.join('\n')}\n`;
    }
    const data = {
      name: o.name ?? m.slug,
      description,
      tools: o.tools ?? joinTools(m.tools?.allow),
      disallowedTools:
        o.disallowedTools ?? (m.tools?.deny.length ? joinTools(m.tools.deny) : undefined),
      model: o.model ?? (m.model ? toNativeModel(m.model.preferred) : undefined),
      skills: o.skills ?? (always.length ? always : undefined),
      ...o.raw,
    };
    return [out(`agents/${o.path ?? `${m.slug}.md`}`, render(data, body))];
  }

  if (m.kind === 'skill') {
    const whenToUse =
      m.triggers.length && !(o.raw && 'when_to_use' in o.raw)
        ? `Use when: ${m.triggers.join('; ')}`
        : undefined;
    const data = {
      name: o.name ?? m.slug,
      description,
      when_to_use: whenToUse,
      license: m.license,
      'allowed-tools': o['allowed-tools'] ?? joinTools(m.allowedTools),
      ...o.raw,
    };
    const dir = `skills/${m.slug}`;
    return [
      out(`${dir}/SKILL.md`, render(data, item.body)),
      ...Object.entries(item.files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rel, content]) => out(`${dir}/${rel}`, content)),
    ];
  }

  // command: `{{args}}` → $ARGUMENTS, `{{argN}}` → $<N-1> (Claude is 0-based), `{{name}}` → $name
  const named: string[] = [];
  let body = renderTemplate(item.body, (name) => {
    if (name === 'args') return '$ARGUMENTS';
    const pos = positionalIndex(name);
    if (pos !== undefined) return `$${pos - 1}`;
    if (!named.includes(name)) named.push(name);
    return `$${name}`;
  });
  const declared = m.arguments.map((a) => a.name).filter((n) => positionalIndex(n) === undefined);
  const argNames = [...declared, ...named.filter((n) => !declared.includes(n))];

  const agent = commandAgent(resolved);
  if (agent) {
    adaptations.push({
      code: 'command.agent.fork',
      message: `Runs in the ${nativeName(agent)} subagent (context: fork).`,
    });
  }
  const preload = refsOf(resolved, 'preloads');
  if (preload.length) {
    adaptations.push({
      code: 'command.preload.prompt',
      message: 'Claude Code commands cannot preload skills; the skills are listed in the prompt.',
    });
    const block = skillListBlock('Use these skills for this task:', preload, (s) => `/${s}`);
    body = `${block}\n${body}`;
  }
  const data = {
    description,
    'allowed-tools': o['allowed-tools'] ?? joinTools(m.allowedTools),
    arguments: argNames.length ? argNames : undefined,
    ...(agent ? { context: 'fork', agent: nativeName(agent) } : {}),
    ...o.raw,
  };
  return [out(`commands/${o.path ?? `${m.slug}.md`}`, render(data, body))];
}
