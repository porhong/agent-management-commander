import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const fail = (code: string, message: string) =>
  Promise.resolve({ ok: false, error: { code, message } });

type Selection = { target: unknown; items: string[] };

const plan = vi.fn();
const apply = vi.fn();
const planRollback = vi.fn();
const removeProject = vi.fn();
const addProject = vi.fn();
const updateSettings = vi.fn();
let planned: Selection[][];
let settings: Record<string, unknown>;
let matrix: unknown[];

const ROWS = [
  {
    id: 'skill.security-checklist',
    kind: 'skill',
    slug: 'security-checklist',
    name: 'Security Checklist',
    version: '1.3.0',
    description: 'Review for injection and secrets.',
    tags: [],
    updatedAt: null,
  },
  {
    id: 'agent.code-reviewer',
    kind: 'agent',
    slug: 'code-reviewer',
    name: 'Code Reviewer',
    version: '2.0.0',
    description: 'Reviews changes.',
    tags: [],
    updatedAt: null,
  },
];

const TARGETS = [
  {
    targetId: 'claude-code:global',
    toolId: 'claude-code',
    scope: 'global',
    label: 'Claude Code · Global',
    roots: { claude: 'C:/Users/dev/.claude' },
  },
  {
    targetId: 'claude-code:project:D:/work/api',
    toolId: 'claude-code',
    scope: 'project',
    label: 'Claude Code · D:/work/api',
    root: 'D:/work/api',
    token: `tok_${'a'.repeat(32)}`,
    roots: { claude: 'D:/work/api/.claude' },
  },
];

/** A plan with one ordinary change, plus anything the test asks for. */
const planWith = (changes: unknown[] = []) => ({
  planId: 'plan_1',
  kind: 'deploy',
  createdAt: '2026-09-25T10:00:00.000Z',
  issues: [],
  targets: [
    {
      targetId: 'claude-code:global',
      label: 'Claude Code · Global',
      status: 'ok',
      changes: [
        {
          id: 'c1',
          op: 'update',
          targetId: 'claude-code:global',
          root: 'claude',
          relPath: 'skills/security-checklist/SKILL.md',
          itemId: 'skill.security-checklist',
          before: 'old line\n',
          after: 'new line\n',
          adaptations: [],
        },
        ...changes,
      ],
    },
  ],
});

const CONFLICT = {
  id: 'c2',
  op: 'conflict',
  targetId: 'claude-code:global',
  root: 'claude',
  relPath: 'agents/code-reviewer.md',
  itemId: 'agent.code-reviewer',
  before: 'theirs\n',
  after: 'ours\n',
  adaptations: [],
  reason: 'foreign',
  pending: 'update',
  options: ['adopt-replace', 'rename', 'skip'],
};

beforeEach(() => {
  planned = [];
  settings = { theme: 'system', autoApply: 'ask', targetSettings: {} };
  matrix = [
    {
      itemId: 'skill.security-checklist',
      targetId: 'claude-code:global',
      deployedVersion: '1.2.0',
      libraryVersion: '1.3.0',
      status: 'outdated',
    },
  ];
  for (const fn of [plan, apply, planRollback, removeProject, addProject, updateSettings]) {
    fn.mockReset();
  }
  plan.mockImplementation((input: { selections: Selection[] }) => {
    planned.push(input.selections);
    return ok(planWith());
  });
  planRollback.mockImplementation(() => ok({ ...planWith(), kind: 'rollback' }));
  apply.mockImplementation(() =>
    ok({ deployId: 'd1', written: ['C:/Users/dev/.claude/x.md'], deleted: [], skipped: [] }),
  );
  removeProject.mockImplementation(() => ok({ removed: true }));
  addProject.mockImplementation(() => ok({ added: true, root: 'D:/work/api' }));
  updateSettings.mockImplementation((input: { patch: Record<string, unknown> }) => {
    settings = { ...settings, ...input.patch };
    return ok(settings);
  });

  (window as unknown as { amc: unknown }).amc = {
    library: {
      list: () => ok(ROWS),
      search: () => ok([]),
      graph: () => ok({ edges: [] }),
      templates: () => ok([]),
      validate: () => ok({ issues: [] }),
      get: () => ok({ manifest: ROWS[0], body: '', files: {} }),
    },
    system: {
      status: () => ok({ ready: true, home: 'C:/amc', warnings: [], counts: {} }),
    },
    settings: { get: () => ok(settings), update: updateSettings },
    tools: {
      detect: () =>
        ok([
          {
            toolId: 'claude-code',
            displayName: 'Claude Code',
            installed: true,
            version: '2.1.282',
            roots: { claude: 'C:/Users/dev/.claude' },
            notes: [],
            capabilities: {},
          },
          {
            toolId: 'codex-cli',
            displayName: 'Codex CLI',
            installed: false,
            roots: {},
            notes: ['Not found on PATH.'],
            capabilities: {},
          },
        ]),
    },
    targets: { list: () => ok(TARGETS), addProject, removeProject },
    dialog: { pickFolder: () => ok({ token: `tok_${'b'.repeat(32)}`, path: 'D:/work/web' }) },
    deploy: {
      matrix: () => ok(matrix),
      plan,
      apply,
      planRollback,
      history: () =>
        ok([
          {
            deployId: '20260925T100000000Z-a1',
            kind: 'deploy',
            createdAt: '2026-09-25T10:00:00.000Z',
            fileCount: 2,
          },
        ]),
      incomplete: () => ok([]),
      report: () =>
        ok({
          deployId: '20260925T100000000Z-a1',
          kind: 'deploy',
          createdAt: '2026-09-25T10:00:00.000Z',
          targets: [
            {
              targetId: 'claude-code:global',
              files: [
                {
                  root: 'claude',
                  relPath: 'skills/security-checklist/SKILL.md',
                  itemId: 'skill.security-checklist',
                  op: 'update',
                },
              ],
            },
          ],
        }),
    },
    index: { rebuild: () => ok({ items: 2, durationMs: 1 }) },
    on: () => () => {},
  };
});

const open = (path: string) =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

describe('deploy screen (T1.7.2)', () => {
  it('carries the items it was sent and plans before writing anything', async () => {
    const user = userEvent.setup();
    open('/deploy?items=agent.code-reviewer');
    expect(await screen.findByText('Code Reviewer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Review the plan/ }));
    await screen.findByRole('dialog', { name: /Review the plan/ });
    expect(plan).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps what a target already holds, so one deploy never retires the rest', async () => {
    const user = userEvent.setup();
    open('/deploy?items=agent.code-reviewer');
    await screen.findByText('Code Reviewer');
    await user.click(screen.getByRole('button', { name: /Review the plan/ }));

    await waitFor(() => expect(planned).toHaveLength(1));
    const global = planned[0]!.find((s) => (s.target as { scope: string }).scope === 'global')!;
    expect(global.items).toEqual(['agent.code-reviewer', 'skill.security-checklist']);
  });

  it('names a project target by its token, never by its path', async () => {
    const user = userEvent.setup();
    open('/deploy?items=agent.code-reviewer');
    await screen.findByText('Code Reviewer');
    await user.click(screen.getByRole('button', { name: /Review the plan/ }));

    await waitFor(() => expect(planned).toHaveLength(1));
    const project = planned[0]!.find((s) => (s.target as { scope: string }).scope === 'project')!;
    expect(project.target).toEqual({
      toolId: 'claude-code',
      scope: 'project',
      token: `tok_${'a'.repeat(32)}`,
    });
    expect(JSON.stringify(planned)).not.toContain('D:/work/api');
  });
});

describe('plan dialog (T1.7.3)', () => {
  const openPlan = async (user: ReturnType<typeof userEvent.setup>) => {
    open('/deploy?items=agent.code-reviewer');
    await screen.findByText('Code Reviewer');
    await user.click(screen.getByRole('button', { name: /Review the plan/ }));
    return screen.findByRole('dialog');
  };

  it('shows each change and its diff on demand', async () => {
    const user = userEvent.setup();
    const dialog = await openPlan(user);
    expect(
      await within(dialog).findByText('skills/security-checklist/SKILL.md'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByText('skills/security-checklist/SKILL.md'));
    expect(await within(dialog).findByText('new line')).toBeInTheDocument();
    expect(within(dialog).getByText('old line')).toBeInTheDocument();
  });

  it('refuses to apply until every conflict has a decision', async () => {
    plan.mockImplementation(() => ok(planWith([CONFLICT])));
    const user = userEvent.setup();
    const dialog = await openPlan(user);

    const applyButton = await within(dialog).findByRole('button', { name: /^Apply/ });
    expect(applyButton).toBeDisabled();
    expect(within(dialog).getByText(/needs a decision/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Keep a copy' }));
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0]![0].resolutions).toEqual({ c2: 'rename' });
  });

  it('refuses to apply while an issue blocks the deploy', async () => {
    plan.mockImplementation(() =>
      ok({
        ...planWith(),
        issues: [
          {
            ruleId: 'ref-broken',
            severity: 'error',
            message: 'agent.code-reviewer references a skill that is missing.',
            blocking: true,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    const dialog = await openPlan(user);
    expect(
      await within(dialog).findByText(/references a skill that is missing/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Apply/ })).toBeDisabled();
  });

  it('explains a stale plan and offers to work it out again', async () => {
    apply.mockImplementation(() => fail('PLAN_STALE', 'Files changed since the plan was made: x'));
    const user = userEvent.setup();
    const dialog = await openPlan(user);
    await user.click(await within(dialog).findByRole('button', { name: /^Apply/ }));

    expect(
      await within(dialog).findByText(/changed on disk since this plan was made/),
    ).toBeInTheDocument();
    plan.mockClear();
    await user.click(within(dialog).getByRole('button', { name: /Work it out again/ }));
    await waitFor(() => expect(plan).toHaveBeenCalled());
  });

  it('reports what it wrote', async () => {
    const user = userEvent.setup();
    const dialog = await openPlan(user);
    await user.click(await within(dialog).findByRole('button', { name: /^Apply/ }));
    expect(await screen.findByText(/C:\/Users\/dev\/\.claude\/x\.md/)).toBeInTheDocument();
  });

  it('applies on its own only when the target says so and nothing conflicts', async () => {
    settings = {
      theme: 'system',
      autoApply: 'ask',
      targetSettings: { 'claude-code:global': { autoApply: 'when-no-conflicts' } },
    };
    const user = userEvent.setup();
    await openPlan(user);
    await waitFor(() => expect(apply).toHaveBeenCalled());
  });

  it('still asks when a change conflicts, whatever the setting says', async () => {
    settings = {
      theme: 'system',
      autoApply: 'when-no-conflicts',
      targetSettings: {},
    };
    plan.mockImplementation(() => ok(planWith([CONFLICT])));
    const user = userEvent.setup();
    const dialog = await openPlan(user);
    await within(dialog).findByText(/needs a decision/);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('matrix (T1.7.4)', () => {
  it('shows a cell per item and target, including what is not deployed', async () => {
    open('/matrix');
    expect(
      await screen.findByRole('button', { name: /Security Checklist in Claude Code · Global/ }),
    ).toHaveTextContent('Outdated');
    expect(
      screen.getByRole('button', { name: /Code Reviewer in Claude Code · Global/ }),
    ).toHaveTextContent('Not deployed');
  });

  it('plans adding an item when an empty cell is clicked', async () => {
    const user = userEvent.setup();
    open('/matrix');
    await user.click(
      await screen.findByRole('button', { name: /Code Reviewer in Claude Code · Global/ }),
    );
    await waitFor(() => expect(planned).toHaveLength(1));
    expect(planned[0]![0]!.items).toEqual(['agent.code-reviewer', 'skill.security-checklist']);
  });

  it('plans retiring an item when a deployed cell is clicked', async () => {
    const user = userEvent.setup();
    open('/matrix');
    await user.click(
      await screen.findByRole('button', { name: /Security Checklist in Claude Code · Global/ }),
    );
    await waitFor(() => expect(planned).toHaveLength(1));
    expect(planned[0]![0]!.items).toEqual([]);
  });

  it('still lists an item that is deployed but gone from the library', async () => {
    matrix = [
      {
        itemId: 'skill.deleted-one',
        targetId: 'claude-code:global',
        deployedVersion: '1.0.0',
        libraryVersion: null,
        status: 'missing',
      },
    ];
    open('/matrix');
    expect(await screen.findByTitle('No longer in the library')).toHaveTextContent('deleted-one');
  });
});

describe('targets (T1.7.1)', () => {
  it('registers a project folder through the picker', async () => {
    const user = userEvent.setup();
    open('/targets');
    await user.click(await screen.findByRole('button', { name: /Add a project folder/ }));
    await waitFor(() =>
      expect(addProject).toHaveBeenCalledWith({ token: `tok_${'b'.repeat(32)}` }),
    );
  });

  it('removing a project stops managing it and deletes nothing', async () => {
    const user = userEvent.setup();
    open('/targets');
    await user.click(await screen.findByRole('button', { name: /Stop managing/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/stay exactly where they are/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Stop managing it' }));
    await waitFor(() => expect(removeProject).toHaveBeenCalledWith({ root: 'D:/work/api' }));
    expect(apply).not.toHaveBeenCalled();
  });

  it('cleaning up the files it owns goes through a plan like anything else', async () => {
    matrix = [
      {
        itemId: 'skill.security-checklist',
        targetId: 'claude-code:project:D:/work/api',
        deployedVersion: '1.3.0',
        libraryVersion: '1.3.0',
        status: 'in-sync',
      },
    ];
    const user = userEvent.setup();
    open('/targets');
    await user.click(await screen.findByRole('button', { name: /Stop managing/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove the files too' }));
    await waitFor(() => expect(planned).toHaveLength(1));
    expect(planned[0]![0]!.items).toEqual([]);
    expect(removeProject).not.toHaveBeenCalled();
  });

  it('remembers when a target may apply without asking', async () => {
    const user = userEvent.setup();
    open('/targets');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /When to apply for Claude Code · Global/ }),
      'when-no-conflicts',
    );
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0]![0].patch.targetSettings).toEqual({
      'claude-code:global': { autoApply: 'when-no-conflicts' },
    });
  });

  it('names the tools it could not find', async () => {
    open('/targets');
    expect(await screen.findByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Not found on PATH.')).toBeInTheDocument();
  });
});

describe('deploy history (T1.7.5)', () => {
  it('lists deploys and shows what one touched', async () => {
    const user = userEvent.setup();
    open('/history');
    await user.click(await screen.findByText('Deployed 2 files'));
    expect(await screen.findByText('skills/security-checklist/SKILL.md')).toBeInTheDocument();
  });

  it('reverting shows a plan first', async () => {
    const user = userEvent.setup();
    open('/history');
    await user.click(await screen.findByText('Deployed 2 files'));
    await user.click(await screen.findByRole('button', { name: /Revert this deploy/ }));
    await waitFor(() =>
      expect(planRollback).toHaveBeenCalledWith({ deployId: '20260925T100000000Z-a1' }),
    );
    expect(await screen.findByRole('dialog', { name: /Review the rollback/ })).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
});
