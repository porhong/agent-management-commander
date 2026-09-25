import {
  alwaysSkills,
  commandAgent,
  inlineSkills,
  refsOf,
  skillListBlock,
  stringifyFrontmatter,
  type Adaptation,
  type CompiledFile,
  type ResolvedItem,
  type Target,
} from '@amc/core';
import {
  ADAPTER_ID,
  AGENTS_ROOT,
  CODEX_ROOT,
  toPromptTemplate,
  toSandbox,
  toSkillTemplate,
  type CodexOverrides,
  type ModelMap,
} from './mapping';
import { stringifyAgentToml } from './toml';

const overridesOf = (r: ResolvedItem) =>
  (r.item.manifest.compat?.overrides[ADAPTER_ID] ?? {}) as CodexOverrides;

/** The name Codex knows an agent by (its TOML `name`), or a skill by (its folder). */
const nativeName = (r: ResolvedItem) =>
  r.item.manifest.kind === 'agent'
    ? (overridesOf(r).name ?? r.item.manifest.slug)
    : r.item.manifest.slug;

function render(data: Record<string, unknown>, body: string): string {
  const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  return Object.keys(defined).length ? stringifyFrontmatter(defined, body) : body;
}

/** Canonical item → Codex files (FORMAT.md §7). Pure and deterministic. */
export function compileItem(
  resolved: ResolvedItem,
  target: Target,
  models: ModelMap = {},
): CompiledFile[] {
  const { item } = resolved;
  const m = item.manifest;
  const o = overridesOf(resolved);
  const adaptations: Adaptation[] = [];
  const note = (code: string, message: string) => adaptations.push({ code, message });
  const description = o.derivedDescription ? undefined : m.description;
  const out = (root: string, relPath: string, content: string | Buffer): CompiledFile => ({
    root,
    relPath,
    content,
    itemId: m.id,
    adaptations,
  });

  if (m.kind === 'agent') {
    const inlined = alwaysSkills(resolved);
    if (inlined.length) {
      note(
        'agent.skills.inlined',
        `Codex can't preload skills; ${inlined.map((s) => s.item.manifest.slug).join(', ')} ${inlined.length === 1 ? 'is' : 'are'} inlined into developer_instructions.`,
      );
    }
    let body = inlineSkills(item.body, inlined);
    const delegates = resolved.refs
      .filter((r) => r.relation === 'delegates-to')
      .map((r) => r.target);
    if (delegates.length) {
      note(
        'agent.delegates.prompt',
        'Codex has no delegation list; allowed agents are listed in the prompt.',
      );
      const list = delegates.map(
        (d) => `- ${nativeName(d)}: ${d.item.manifest.description.split('\n')[0]}`,
      );
      body = `${body.trimEnd()}\n\n## Agents you may delegate to\n\n${list.join('\n')}\n`;
    }

    let model = o.model;
    if (!model && m.model && m.model.preferred !== 'inherit') {
      model = models[m.model.preferred];
      if (!model) {
        note(
          'agent.model.unmapped',
          `No Codex model is configured for the "${m.model.preferred}" tier; the agent uses the default model.`,
        );
      }
    }

    let sandbox = o.sandbox_mode;
    if (!sandbox && m.tools?.allow) {
      sandbox = toSandbox(m.tools.allow);
      note(
        'agent.tools.sandbox',
        `Codex has no per-tool permissions; tools map to sandbox_mode = "${sandbox}".`,
      );
    }
    if (m.tools?.deny.length) {
      note(
        'agent.tools.deny.dropped',
        'Codex has no tool deny-list; denied tools are not enforced.',
      );
    }

    const toml = stringifyAgentToml(
      { name: o.name ?? m.slug, description, model, sandbox_mode: sandbox, ...o.raw },
      body,
    );
    return [out(CODEX_ROOT, `agents/${o.path ?? `${m.slug}.toml`}`, toml)];
  }

  if (m.kind === 'skill') {
    if (m.allowedTools && !(o.raw && 'allowed-tools' in o.raw)) {
      note(
        'skill.tools.dropped',
        'Codex has no per-skill tool permissions; allowedTools is ignored.',
      );
    }
    if (m.triggers.length) {
      note(
        'skill.triggers.dropped',
        'Codex matches skills by description only; triggers are ignored.',
      );
    }
    const data = { name: o.name ?? m.slug, description, license: m.license, ...o.raw };
    const dir = `skills/${m.slug}`;
    return [
      out(AGENTS_ROOT, `${dir}/SKILL.md`, render(data, item.body)),
      ...Object.entries(item.files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rel, content]) => out(AGENTS_ROOT, `${dir}/${rel}`, content)),
    ];
  }

  // command
  const preamble: string[] = [];
  const agent = commandAgent(resolved);
  if (agent) {
    note(
      'command.agent.prompt',
      `Codex commands can't choose an agent; the prompt asks for ${nativeName(agent)}.`,
    );
    preamble.push(`Delegate this task to the \`${nativeName(agent)}\` agent.\n`);
  }
  const preload = refsOf(resolved, 'preloads');
  if (preload.length) {
    note(
      'command.preload.prompt',
      'Codex commands cannot preload skills; the skills are listed in the prompt.',
    );
    preamble.push(skillListBlock('Use these skills for this task:', preload, (s) => `$${s}`));
  }
  if (m.allowedTools && !(o.raw && 'allowed-tools' in o.raw)) {
    note(
      'command.tools.dropped',
      'Codex has no per-command tool permissions; allowedTools is ignored.',
    );
  }
  const withPreamble = (body: string) =>
    preamble.length ? `${preamble.join('\n')}\n${body}` : body;

  if (target.scope === 'global') {
    note(
      'command.prompt.deprecated',
      'Codex custom prompts are deprecated; invoke as /prompts:' + m.slug + '.',
    );
    const { body, unmapped } = toPromptTemplate(item.body);
    if (unmapped.length) {
      note(
        'command.args.positional',
        `Codex supports $1–$9 only; ${unmapped.join(', ')} became $ARGUMENTS.`,
      );
    }
    const data = { description, ...o.raw };
    return [
      out(CODEX_ROOT, `prompts/${o.path ?? `${m.slug}.md`}`, render(data, withPreamble(body))),
    ];
  }

  // Project scope: prompts don't exist there, so the command becomes a repo skill (`$slug`).
  note('command.as-skill', `Codex has no project commands; deployed as the skill $${m.slug}.`);
  const args = m.arguments.map((a) => `- <${a.name}>${a.description ? `: ${a.description}` : ''}`);
  const argBlock = args.length
    ? `Arguments (ask the user if missing):\n\n${args.join('\n')}\n\n`
    : '';
  const body = withPreamble(argBlock + toSkillTemplate(item.body));
  return [
    out(
      AGENTS_ROOT,
      `skills/${m.slug}/SKILL.md`,
      render({ name: m.slug, description: m.description }, body),
    ),
  ];
}
