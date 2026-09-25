import type { AmcApi, AmcEvent } from '../../../preload/api';
import { CHANNEL_NAMES } from '../../../shared/channels';

/**
 * In-memory stand-in for the real IPC surface (T1.5.7), enabled with `VITE_AMC_MOCK=1`, so the
 * UI track can build screens before the matching handler exists. It mirrors the contract's
 * shapes, not its behaviour: writes update the fixture data and nothing touches disk.
 */

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

type Row = {
  id: string;
  kind: string;
  slug: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  updatedAt: string | null;
};

const ROWS: Row[] = [
  {
    id: 'skill.security-checklist',
    kind: 'skill',
    slug: 'security-checklist',
    name: 'Security Checklist',
    version: '1.3.0',
    description: 'Use when reviewing code for security issues: injection, authz, secrets.',
    tags: ['security', 'review'],
    updatedAt: '2026-09-20T09:00:00.000Z',
  },
  {
    id: 'skill.style-guide',
    kind: 'skill',
    slug: 'style-guide',
    name: 'Style Guide',
    version: '0.4.1',
    description: 'House naming and formatting conventions for TypeScript.',
    tags: ['style'],
    updatedAt: '2026-09-18T12:30:00.000Z',
  },
  {
    id: 'agent.code-reviewer',
    kind: 'agent',
    slug: 'code-reviewer',
    name: 'Code Reviewer',
    version: '2.0.0',
    description: 'Reviews changes for correctness, security, and readability.',
    tags: ['review'],
    updatedAt: '2026-09-22T16:45:00.000Z',
  },
  {
    id: 'command.review-pr',
    kind: 'command',
    slug: 'review-pr',
    name: 'Review PR',
    version: '1.0.0',
    description: 'Review a pull request with the code reviewer agent.',
    tags: [],
    updatedAt: '2026-09-22T16:50:00.000Z',
  },
];

const BODIES: Record<string, string> = {
  'skill.security-checklist':
    '# Security checklist\n\n- [ ] Inputs validated\n- [ ] No secrets in code\n',
  'skill.style-guide': '# Style\n\nPrefer named exports.\n',
  'agent.code-reviewer': 'You are a senior code reviewer.\n',
  'command.review-pr': 'Review pull request {{pr}}.\n',
};

const TARGETS = [
  {
    targetId: 'claude-code:global',
    toolId: 'claude-code',
    scope: 'global' as const,
    label: 'Claude Code · Global',
    roots: { claude: 'C:/Users/dev/.claude' },
  },
  {
    targetId: 'codex-cli:global',
    toolId: 'codex-cli',
    scope: 'global' as const,
    label: 'Codex CLI · Global',
    roots: { codex: 'C:/Users/dev/.codex', agents: 'C:/Users/dev/.agents' },
  },
];

const item = (id: string) => {
  const row = ROWS.find((r) => r.id === id);
  if (!row) throw new Error(`mock: no item ${id}`);
  return {
    manifest: { ...row } as Record<string, unknown>,
    body: BODIES[id] ?? '',
    files: {} as Record<string, string>,
  };
};

const listeners = new Set<(e: AmcEvent) => void>();

const impl: Record<string, (input?: unknown) => Promise<{ ok: true; value: unknown }>> = {
  'system.probe': () =>
    ok({
      versions: { electron: '44.4.5', node: '24.21.0', chrome: '142.0.0.0' },
      sqlite: { ok: true, version: '3.53.4', fts5: true },
    }),
  'system.diagnostics': () => ok({ text: '# AMC diagnostics (mock)\n' }),
  'system.status': () =>
    ok({
      ready: true,
      home: 'C:/Users/dev/.amc',
      warnings: [],
      counts: { items: ROWS.length, deployments: 3, targets: TARGETS.length },
    }),

  'settings.get': () =>
    ok({ schemaVersion: 1, theme: 'system', autoApply: 'ask', projectRoots: [], onboarded: true }),
  'settings.update': (input) =>
    ok({
      schemaVersion: 1,
      theme: 'system',
      autoApply: 'ask',
      projectRoots: [],
      onboarded: true,
      ...(input as Record<string, unknown>),
    }),

  'dialog.pickFolder': () => ok({ token: `tok_${'0'.repeat(32)}`, path: 'D:/work/api' }),

  'library.list': (input) => {
    const { kind, tag } = (input ?? {}) as { kind?: string; tag?: string };
    return ok(ROWS.filter((r) => (!kind || r.kind === kind) && (!tag || r.tags.includes(tag))));
  },
  'library.search': (input) => {
    const q = ((input ?? {}) as { query: string }).query.toLowerCase();
    return ok(ROWS.filter((r) => `${r.name} ${r.slug} ${r.description}`.toLowerCase().includes(q)));
  },
  'library.get': (input) => ok(item(((input ?? {}) as { id: string }).id)),
  'library.create': (input) =>
    ok({
      manifest: { version: '0.1.0', ...(input as Record<string, unknown>) },
      body: '',
      files: {},
    }),
  'library.update': (input) =>
    ok({ ...item(((input ?? {}) as { id: string }).id), ...(input as Record<string, unknown>) }),
  'library.rename': (input) => ok(item(((input ?? {}) as { id: string }).id)),
  'library.duplicate': (input) => ok(item(((input ?? {}) as { id: string }).id)),
  'library.delete': () => ok({ deleted: true }),
  'library.relations': () =>
    ok({
      uses: [{ id: 'skill.security-checklist', relation: 'equips', mode: 'always' }],
      usedBy: [{ id: 'command.review-pr', relation: 'uses-agent', mode: null }],
    }),
  'library.history': () =>
    ok([
      {
        rev: 'b7d1c2a',
        summary: 'amc: update skill.security-checklist (1.3.0)',
        timestamp: '2026-09-20T09:00:00.000Z',
      },
      {
        rev: '4f0aa19',
        summary: 'amc: create skill.security-checklist (1.0.0)',
        timestamp: '2026-09-01T08:00:00.000Z',
      },
    ]),
  'library.restore': (input) => ok(item(((input ?? {}) as { id: string }).id)),
  'library.templates': () =>
    ok([
      {
        id: 'checklist-skill',
        kind: 'skill',
        title: 'Checklist skill',
        summary: 'A step-by-step checklist.',
      },
    ]),
  'library.validate': () =>
    ok({
      issues: [
        {
          ruleId: 'description-min',
          severity: 'warning',
          message: 'Description is shorter than 20 characters.',
          itemId: 'skill.style-guide',
          path: 'description',
          blocking: false,
        },
      ],
    }),

  'tools.detect': () =>
    ok(
      TARGETS.map((t) => ({
        toolId: t.toolId,
        displayName: t.label.split(' · ')[0]!,
        installed: true,
        version: '1.0.0',
        roots: t.roots,
        notes: [],
        capabilities: {},
      })),
    ),
  'targets.list': () => ok(TARGETS),
  'targets.addProject': () => ok({ added: true, root: 'D:/work/api' }),
  'targets.removeProject': () => ok({ removed: true }),

  'compile.preview': (input) => {
    const { id } = (input ?? {}) as { id: string };
    return ok({
      files: [
        {
          root: 'claude',
          relPath: `skills/${id.split('.')[1]}/SKILL.md`,
          content: `---\nname: ${id.split('.')[1]}\n---\n\n${BODIES[id] ?? ''}`,
          binary: false,
          adaptations: [],
        },
      ],
    });
  },

  'deploy.plan': () =>
    ok({
      planId: 'plan_mock_1',
      kind: 'deploy',
      createdAt: new Date().toISOString(),
      issues: [],
      targets: [
        {
          targetId: 'claude-code:global',
          label: 'Claude Code · Global',
          status: 'ok',
          changes: [
            {
              id: 'claude-code:global|claude|skills/security-checklist/SKILL.md',
              op: 'update',
              targetId: 'claude-code:global',
              root: 'claude',
              relPath: 'skills/security-checklist/SKILL.md',
              itemId: 'skill.security-checklist',
              before: '# Security checklist\n\n- [ ] Inputs validated\n',
              after: BODIES['skill.security-checklist']!,
              adaptations: [],
            },
          ],
        },
      ],
    }),
  'deploy.apply': () =>
    ok({
      deployId: '20260925T100000000Z-mock01',
      written: ['C:/Users/dev/.claude/skills/security-checklist/SKILL.md'],
      deleted: [],
      skipped: [],
    }),
  'deploy.history': () =>
    ok([
      {
        deployId: '20260925T100000000Z-mock01',
        kind: 'deploy',
        createdAt: '2026-09-25T10:00:00.000Z',
        fileCount: 2,
      },
    ]),
  'deploy.planRollback': () => impl['deploy.plan']!(undefined as never),
  'deploy.matrix': () =>
    ok([
      {
        itemId: 'skill.security-checklist',
        targetId: 'claude-code:global',
        deployedVersion: '1.2.0',
        libraryVersion: '1.3.0',
        status: 'outdated',
      },
      {
        itemId: 'agent.code-reviewer',
        targetId: 'claude-code:global',
        deployedVersion: '2.0.0',
        libraryVersion: '2.0.0',
        status: 'in-sync',
      },
    ]),
  'deploy.incomplete': () => ok([]),
  'deploy.recover': () => ok({ recovered: true }),
  'index.rebuild': () => ok({ items: ROWS.length, durationMs: 12 }),
};

/** Installs the mock as `window.amc`. Call once at startup when `VITE_AMC_MOCK=1`. */
export function installMockApi(): void {
  const api: Record<string, unknown> = {
    on(listener: (e: AmcEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  for (const channel of CHANNEL_NAMES) {
    const [group, method] = channel.split('.') as [string, string];
    const g = (api[group] ??= {}) as Record<string, unknown>;
    g[method] = (input?: unknown) => {
      const handler = impl[channel];
      if (!handler)
        return Promise.resolve({ ok: false, error: { code: 'NOT_MOCKED', message: channel } });
      return handler(input);
    };
  }
  (window as unknown as { amc: AmcApi }).amc = api as unknown as AmcApi;
}

/** Test/dev helper: pushes an event to every subscriber. */
export const emitMockEvent = (event: AmcEvent): void => listeners.forEach((l) => l(event));
