import { join } from 'node:path';
import {
  descriptionLimitRule,
  type AdapterHost,
  type CapabilityMatrix,
  type DetectResult,
  type Rule,
  type RuleFinding,
  type Target,
  type TargetRoots,
  type ToolAdapter,
} from '@amc/core';
import { compileItem } from './compile';
import { ADAPTER_ID, AGENTS_ROOT, CODEX_ROOT, type ModelMap } from './mapping';
import { parseGroup } from './parse';
import { scanRoots } from './scan';

export {
  ADAPTER_ID as CODEX_CLI_ADAPTER_ID,
  AGENTS_ROOT as CODEX_AGENTS_ROOT,
  CODEX_ROOT,
  toSandbox,
  toCanonicalTemplate,
  toPromptTemplate,
  type CodexOverrides,
  type ModelMap,
} from './mapping';
export { compileItem, parseGroup, scanRoots };
export { parseToml, stringifyAgentToml } from './toml';

/** FORMAT.md §7. */
export const CODEX_CLI_CAPABILITIES: CapabilityMatrix = {
  skills: 'native',
  agents: 'native',
  commands: { global: 'native', project: 'degraded' },
  equipAlways: 'degraded',
  equipOnDemand: 'native',
  commandAgent: 'degraded',
  commandPreload: 'degraded',
  namedArgs: 'native',
  agentTools: 'degraded',
  skillTools: 'unsupported',
  modelHint: 'native',
  skillScripts: 'native',
};

/** Agent Skills spec limit for `description` (FORMAT.md §2). */
export const SKILL_DESCRIPTION_LIMIT = 1024;

/**
 * In project scope a command is deployed as a skill, so it shares the skills namespace and the
 * skill description limit.
 */
const projectCommandRule: Rule = {
  id: 'codex-cli:project-command-as-skill',
  severity: 'error',
  description: 'Project commands fit the skills namespace and description limit',
  check: (ctx) =>
    ctx.targets
      .filter((t) => t.toolId === ADAPTER_ID && t.id.includes(':project:'))
      .flatMap((t) => {
        const skillSlugs = new Set(
          ctx.items.filter((i) => i.manifest.kind === 'skill').map((i) => i.manifest.slug),
        );
        return ctx.items.flatMap((i): RuleFinding[] => {
          const m = i.manifest;
          if (m.kind !== 'command') return [];
          const findings: RuleFinding[] = [];
          if (skillSlugs.has(m.slug)) {
            findings.push({
              itemId: m.id,
              targetId: t.id,
              path: 'slug',
              message: `In Codex projects this command becomes the skill "${m.slug}", which a skill already uses. Rename one of them.`,
            });
          }
          if (m.description.length > SKILL_DESCRIPTION_LIMIT) {
            findings.push({
              itemId: m.id,
              targetId: t.id,
              path: 'description',
              message: `Description is ${m.description.length} characters; Codex skills allow ${SKILL_DESCRIPTION_LIMIT}`,
            });
          }
          return findings;
        });
      }),
};

/** Codex home, relocated by CODEX_HOME. */
export const codexHome = (host: Pick<AdapterHost, 'home' | 'env'>): string =>
  host.env['CODEX_HOME'] || join(host.home, '.codex');

export interface CodexAdapterOptions {
  /** Tier → model. Unmapped tiers leave the model to Codex's default. */
  models?: ModelMap;
}

export function createCodexAdapter(host: AdapterHost, opts: CodexAdapterOptions = {}): ToolAdapter {
  const models = opts.models ?? {};
  const paths = (target: Target): TargetRoots =>
    target.scope === 'global'
      ? { [CODEX_ROOT]: codexHome(host), [AGENTS_ROOT]: join(host.home, '.agents') }
      : { [CODEX_ROOT]: join(target.root, '.codex'), [AGENTS_ROOT]: join(target.root, '.agents') };

  return {
    id: ADAPTER_ID,
    displayName: 'Codex CLI',
    capabilities: CODEX_CLI_CAPABILITIES,
    rules: [
      descriptionLimitRule(ADAPTER_ID, SKILL_DESCRIPTION_LIMIT, 'error', ['skill']),
      projectCommandRule,
    ],

    async detect(): Promise<DetectResult> {
      const roots = paths({ toolId: ADAPTER_ID, scope: 'global' });
      const folder = (await host.fs.stat(roots[CODEX_ROOT]!))?.kind === 'dir';
      const version = (await host.runVersion?.('codex', ['--version'])) ?? undefined;
      const notes: string[] = [];
      if (host.env['CODEX_HOME']) notes.push('Using CODEX_HOME');
      if (folder && !version) notes.push('CLI not found on PATH; using the config folder');
      notes.push('Skills live in ~/.agents/skills, which other tools may also read');
      return { installed: folder || !!version, ...(version && { version }), roots, notes };
    },

    paths,
    scan: (target) => scanRoots(host.fs, paths(target), { prompts: target.scope === 'global' }),
    parse: (group) => parseGroup(group, models),
    compile: (item, target) => compileItem(item, target, models),
  };
}
