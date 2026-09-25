import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';

const ok = (value: unknown) => Promise.resolve({ ok: true, value });

const updateSettings = vi.fn();
const pickFolder = vi.fn();
const relaunch = vi.fn();
const driftCall = vi.fn();

let settings: Record<string, unknown>;
let issues: unknown[];
let matrix: unknown[];
let drift: { checkedAt: string; warnings: string[]; entries: unknown[] };
let incomplete: unknown[];

const ROWS = [
  {
    id: 'skill.security-checklist',
    kind: 'skill',
    slug: 'security-checklist',
    name: 'Security Checklist',
    version: '1.3.0',
    description: 'Review for injection and secrets.',
    tags: [],
    updatedAt: '2026-09-25T09:00:00.000Z',
  },
];

beforeEach(() => {
  settings = { theme: 'system', autoApply: 'ask', onboarded: true, logLevel: 'info' };
  issues = [];
  // A healthy starting point: one item, deployed and current.
  matrix = [
    {
      itemId: 'skill.security-checklist',
      targetId: 'claude-code:global',
      deployedVersion: '1.3.0',
      libraryVersion: '1.3.0',
      status: 'in-sync',
    },
  ];
  incomplete = [];
  drift = { checkedAt: '2026-09-25T10:00:00.000Z', warnings: [], entries: [] };
  for (const fn of [updateSettings, pickFolder, relaunch, driftCall]) fn.mockReset();
  updateSettings.mockImplementation((input: { patch: Record<string, unknown> }) => {
    settings = { ...settings, ...input.patch };
    return ok(settings);
  });
  pickFolder.mockImplementation(() =>
    ok({ token: `tok_${'c'.repeat(32)}`, path: 'D:/work/my-library' }),
  );
  relaunch.mockImplementation(() => ok({ relaunching: true }));
  driftCall.mockImplementation(() => ok(drift));

  (window as unknown as { amc: unknown }).amc = {
    library: {
      list: () => ok(ROWS),
      search: () => ok([]),
      graph: () => ok({ edges: [] }),
      templates: () => ok([]),
      validate: () => ok({ issues }),
      get: () => ok({ manifest: { ...ROWS[0], kind: 'skill' }, body: '', files: {} }),
      relations: () => ok({ uses: [], usedBy: [] }),
      history: () => ok([]),
    },
    system: {
      status: () =>
        ok({
          ready: true,
          home: 'C:/Users/dev/.amc',
          warnings: [],
          counts: { items: 1, deployments: 1, targets: 1 },
        }),
      diagnostics: () => ok({ text: '# AMC diagnostics\nversions: …\n' }),
      reveal: () => ok({ opened: true }),
      relaunch,
    },
    settings: { get: () => ok(settings), update: updateSettings },
    status: { drift: driftCall },
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
    targets: {
      list: () =>
        ok([
          {
            targetId: 'claude-code:global',
            toolId: 'claude-code',
            scope: 'global',
            label: 'Claude Code · Global',
            roots: { claude: 'C:/Users/dev/.claude' },
          },
        ]),
    },
    deploy: {
      matrix: () => ok(matrix),
      history: () => ok([]),
      incomplete: () => ok(incomplete),
      plan: () => ok({ planId: 'p', kind: 'deploy', createdAt: '', issues: [], targets: [] }),
    },
    dialog: { pickFolder },
    index: { rebuild: () => ok({ items: 1, durationMs: 2 }) },
    on: () => () => {},
  };
});

const open = (path = '/') =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

describe('dashboard (T1.9.2)', () => {
  it('says so plainly when there is nothing to do', async () => {
    open();
    expect(await screen.findByText(/Everything matches/)).toBeInTheDocument();
  });

  it('shows each tool, whether or not it is installed', async () => {
    open();
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Not found on PATH.')).toBeInTheDocument();
  });

  it('turns a blocking issue into a row that goes to the item that has it', async () => {
    issues = [
      {
        ruleId: 'ref-broken',
        severity: 'error',
        message: 'agent.code-reviewer references a skill that is missing.',
        itemId: 'skill.security-checklist',
        blocking: true,
      },
    ];
    const user = userEvent.setup();
    open();
    expect(await screen.findByText('One problem stops a deploy')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fix it' }));
    expect(await screen.findByRole('heading', { name: 'Security Checklist' })).toBeInTheDocument();
  });

  it('offers to redeploy what has fallen behind', async () => {
    matrix = [
      {
        itemId: 'skill.security-checklist',
        targetId: 'claude-code:global',
        deployedVersion: '1.2.0',
        libraryVersion: '1.3.0',
        status: 'outdated',
      },
    ];
    const user = userEvent.setup();
    open();
    expect(await screen.findByText(/1 deployment is behind the library/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Deploy the new version/ }));
    expect(await screen.findByRole('heading', { name: 'Deploy', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Security Checklist')).toBeInTheDocument();
  });

  it('points an interrupted deploy at history', async () => {
    incomplete = [{ deployId: '2026-a1', startedAt: '2026-09-25T10:00:00.000Z' }];
    open();
    expect(await screen.findByText('A deploy never finished')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort it out' })).toBeInTheDocument();
  });
});

describe('keeping the picture current (T1.9.3)', () => {
  it('notices a file edited outside AMC on the next check', async () => {
    open();
    await screen.findByText(/Everything matches/);

    // The kind of thing that happens when someone edits ~/.claude by hand.
    drift = {
      checkedAt: '2026-09-25T10:05:00.000Z',
      warnings: [],
      entries: [
        {
          targetId: 'claude-code:global',
          root: 'claude',
          relPath: 'skills/security-checklist/SKILL.md',
          itemId: 'skill.security-checklist',
          state: 'drifted',
        },
      ],
    };
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(await screen.findByText('1 file changed outside AMC')).toBeInTheDocument();
    expect(screen.getByText(/skills\/security-checklist\/SKILL\.md/)).toBeInTheDocument();
  });

  it('offers to put back a deployed file that was deleted', async () => {
    drift = {
      checkedAt: '2026-09-25T10:00:00.000Z',
      warnings: [],
      entries: [
        {
          targetId: 'claude-code:global',
          root: 'claude',
          relPath: 'skills/security-checklist/SKILL.md',
          itemId: 'skill.security-checklist',
          state: 'missing',
        },
      ],
    };
    const user = userEvent.setup();
    open();
    expect(await screen.findByText(/1 deployed file is gone/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Put them back/ }));
    expect(await screen.findByRole('heading', { name: 'Deploy', level: 1 })).toBeInTheDocument();
  });

  it('shows drift in the matrix, whatever the version numbers say', async () => {
    matrix = [
      {
        itemId: 'skill.security-checklist',
        targetId: 'claude-code:global',
        deployedVersion: '1.3.0',
        libraryVersion: '1.3.0',
        status: 'in-sync',
      },
    ];
    drift = {
      checkedAt: '2026-09-25T10:00:00.000Z',
      warnings: [],
      entries: [
        {
          targetId: 'claude-code:global',
          root: 'claude',
          relPath: 'skills/security-checklist/SKILL.md',
          itemId: 'skill.security-checklist',
          state: 'drifted',
        },
      ],
    };
    open('/matrix');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Security Checklist in Claude Code · Global/ }),
      ).toHaveTextContent('Drifted'),
    );
  });
});

describe('onboarding (T1.9.1)', () => {
  beforeEach(() => {
    settings = { theme: 'system', onboarded: false };
  });

  it('greets a new library and walks through to importing', async () => {
    const user = userEvent.setup();
    open();
    const dialog = await screen.findByRole('dialog', { name: /Welcome to AMC/ });
    expect(
      within(dialog).getByRole('heading', { name: /One library, every tool/ }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Next/ }));
    expect(within(dialog).getByText('C:/Users/dev/.amc/library')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Next/ }));
    expect(within(dialog).getByText('Claude Code')).toBeInTheDocument();
    expect(within(dialog).getByText('not found')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Next/ }));
    expect(within(dialog).getByText(/writes nothing back/)).toBeInTheDocument();
  });

  it('can go back a step', async () => {
    const user = userEvent.setup();
    open();
    const dialog = await screen.findByRole('dialog', { name: /Welcome to AMC/ });
    await user.click(within(dialog).getByRole('button', { name: /Next/ }));
    await user.click(within(dialog).getByRole('button', { name: /Back/ }));
    expect(
      within(dialog).getByRole('heading', { name: /One library, every tool/ }),
    ).toBeInTheDocument();
  });

  it('remembers it was seen, and writes nothing else', async () => {
    const user = userEvent.setup();
    open();
    const dialog = await screen.findByRole('dialog', { name: /Welcome to AMC/ });
    await user.click(within(dialog).getByRole('button', { name: /Skip/ }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ patch: { onboarded: true } }),
    );
    expect(updateSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('takes you to import when you ask it to', async () => {
    const user = userEvent.setup();
    open();
    const dialog = await screen.findByRole('dialog', { name: /Welcome to AMC/ });
    for (let i = 0; i < 3; i++) {
      await user.click(within(dialog).getByRole('button', { name: /Next/ }));
    }
    await user.click(within(dialog).getByRole('button', { name: /Look at what I have/ }));
    expect(await screen.findByRole('heading', { name: 'Import', level: 1 })).toBeInTheDocument();
  });

  it('stays out of the way once it has been seen', async () => {
    settings = { theme: 'system', onboarded: true };
    open();
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.queryByRole('dialog', { name: /Welcome to AMC/ })).not.toBeInTheDocument();
  });
});

describe('settings (T1.9.1)', () => {
  it('writes a setting as soon as it changes', async () => {
    const user = userEvent.setup();
    open('/settings');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Theme' }), 'dark');
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ patch: { theme: 'dark' } }));
  });

  it('can start the welcome again', async () => {
    const user = userEvent.setup();
    open('/settings');
    await user.click(await screen.findByRole('button', { name: /Start it/ }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ patch: { onboarded: false } }),
    );
  });

  it('points the library elsewhere without moving anything, and offers a restart', async () => {
    const user = userEvent.setup();
    open('/settings');
    await user.click(await screen.findByRole('button', { name: /Choose another/ }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ patch: { libraryRoot: 'D:/work/my-library' } }),
    );
    expect(await screen.findByText(/previous library was left untouched/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
  });

  it('shows diagnostics on request', async () => {
    const user = userEvent.setup();
    open('/settings');
    await user.click(await screen.findByRole('button', { name: /Show them/ }));
    expect(await screen.findByText(/# AMC diagnostics/)).toBeInTheDocument();
  });
});
