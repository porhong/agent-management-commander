import { join } from 'node:path';
import type {
  AdapterHost,
  CapabilityMatrix,
  DetectResult,
  Rule,
  Target,
  TargetRoots,
  ToolAdapter,
} from '@amc/core';
import { compileItem, ROOT } from './compile';
import { ADAPTER_ID } from './mapping';
import { parseGroup } from './parse';
import { scanRoot } from './scan';

export { ADAPTER_ID as CLAUDE_CODE_ADAPTER_ID } from './mapping';
export { compileItem, parseGroup, scanRoot, ROOT as CLAUDE_ROOT };
export type { ClaudeOverrides } from './parse';

/** docs: FORMAT.md; the "why" of each entry is in docs/concept/03 §3. */
export const CLAUDE_CODE_CAPABILITIES: CapabilityMatrix = {
  skills: 'native',
  agents: 'native',
  commands: { global: 'native', project: 'native' },
  equipAlways: 'native',
  equipOnDemand: 'native',
  commandAgent: 'native',
  commandPreload: 'degraded',
  namedArgs: 'native',
  agentTools: 'native',
  skillTools: 'native',
  modelHint: 'native',
  skillScripts: 'native',
};

/** `description` + `when_to_use` share one 1,536-character budget (FORMAT.md §3). */
const SKILL_LISTING_LIMIT = 1536;

const skillListingRule: Rule = {
  id: 'claude-code:skill-listing-length',
  severity: 'warning',
  description: 'Skill description plus triggers fit the 1,536-character listing',
  check: (ctx) =>
    ctx.targets
      .filter((t) => t.toolId === ADAPTER_ID)
      .flatMap((t) =>
        ctx.items.flatMap((i) => {
          const m = i.manifest;
          if (m.kind !== 'skill' || m.triggers.length === 0) return [];
          const size = m.description.length + `Use when: ${m.triggers.join('; ')}`.length;
          return size > SKILL_LISTING_LIMIT
            ? [
                {
                  itemId: m.id,
                  targetId: t.id,
                  path: 'triggers',
                  message: `Description and triggers are ${size} characters; Claude Code truncates at ${SKILL_LISTING_LIMIT}`,
                },
              ]
            : [];
        }),
      ),
};

/** Global root: `~/.claude`, relocated wholesale by CLAUDE_CONFIG_DIR. */
export const claudeHome = (host: Pick<AdapterHost, 'home' | 'env'>): string =>
  host.env['CLAUDE_CONFIG_DIR'] || join(host.home, '.claude');

export function createClaudeCodeAdapter(host: AdapterHost): ToolAdapter {
  const paths = (target: Target): TargetRoots => ({
    [ROOT]: target.scope === 'global' ? claudeHome(host) : join(target.root, '.claude'),
  });

  return {
    id: ADAPTER_ID,
    displayName: 'Claude Code',
    capabilities: CLAUDE_CODE_CAPABILITIES,
    rules: [skillListingRule],

    async detect(): Promise<DetectResult> {
      const roots = paths({ toolId: ADAPTER_ID, scope: 'global' });
      const folder = (await host.fs.stat(roots[ROOT]!))?.kind === 'dir';
      const version = (await host.runVersion?.('claude', ['--version'])) ?? undefined;
      const notes: string[] = [];
      if (host.env['CLAUDE_CONFIG_DIR']) notes.push('Using CLAUDE_CONFIG_DIR');
      if (folder && !version) notes.push('CLI not found on PATH; using the config folder');
      return { installed: folder || !!version, ...(version && { version }), roots, notes };
    },

    paths,
    scan: (target) => scanRoot(host.fs, paths(target)[ROOT]!),
    parse: (group) => parseGroup(group),
    compile: compileItem,
  };
}
