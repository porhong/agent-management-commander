import {
  renderPlaceholders,
  stringifyFrontmatter,
  type Adaptation,
  type CompiledFile,
  type LibraryItem,
} from '@amc/core';
import { ADAPTER_ID, toNativeModel, toNativeTools } from './mapping';
import type { ClaudeOverrides } from './parse';

const slugOfRef = (ref: string) => ref.slice(ref.indexOf('.') + 1);
const joinTools = (abstract: string[] | undefined) =>
  abstract ? toNativeTools(abstract).join(', ') : undefined;

function render(data: Record<string, unknown>, body: string): string {
  const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  // A file with nothing to put in frontmatter is emitted as plain Markdown.
  return Object.keys(defined).length ? stringifyFrontmatter(defined, body) : body;
}

/** Canonical item → Claude Code files. Pure: no I/O, deterministic output. */
export function compileItem(item: LibraryItem): CompiledFile[] {
  const m = item.manifest;
  const o = (m.compat?.overrides[ADAPTER_ID] ?? {}) as ClaudeOverrides;
  const adaptations: Adaptation[] = [];
  const description = o.derivedDescription ? undefined : m.description;
  const out = (relPath: string, content: string | Buffer): CompiledFile => ({
    relPath,
    content,
    itemId: m.id,
    adaptations,
  });

  if (m.kind === 'agent') {
    const always = m.skills.filter((s) => s.mode === 'always').map((s) => slugOfRef(s.ref));
    if (m.skills.some((s) => s.mode === 'on-demand')) {
      adaptations.push({
        code: 'skills.on-demand.native',
        message: 'On-demand skills are discovered natively by Claude Code; no agent change needed.',
      });
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
    return [out(`agents/${o.path ?? `${m.slug}.md`}`, render(data, item.body))];
  }

  if (m.kind === 'skill') {
    if (m.triggers.length) {
      adaptations.push({
        code: 'skill.triggers.unmapped',
        message: 'Triggers are not yet compiled for Claude Code (planned: when_to_use).',
      });
    }
    const data = {
      name: o.name ?? m.slug,
      description,
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

  // command
  const position = new Map(m.arguments.map((a, i) => [a.name, i + 1]));
  const body = renderPlaceholders(item.body, (name) => {
    if (name === 'args') return '$ARGUMENTS';
    const direct = /^arg(\d)$/.exec(name);
    if (direct) return `$${direct[1]}`;
    return `$${position.get(name) ?? 'ARGUMENTS'}`;
  });
  const data = {
    description,
    'allowed-tools': o['allowed-tools'] ?? joinTools(m.allowedTools),
    ...o.raw,
  };
  return [out(`commands/${o.path ?? `${m.slug}.md`}`, render(data, body))];
}
