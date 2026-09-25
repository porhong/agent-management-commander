import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';

const ok = (value: unknown) => Promise.resolve({ ok: true, value });

const scan = vi.fn();
const adopt = vi.fn();
const plan = vi.fn();
let groups: unknown[];

const SOURCES = [
  {
    candidateId: 'claude-code:global|claude|skills/security-checklist/SKILL.md',
    targetId: 'claude-code:global',
    toolId: 'claude-code',
    label: 'Claude Code · Global',
    relPath: 'skills/security-checklist/SKILL.md',
    linked: false,
    reason: 'same-content',
    similarity: 1,
    warnings: [],
  },
  {
    candidateId: 'codex-cli:global|agents|skills/security-checklist/SKILL.md',
    targetId: 'codex-cli:global',
    toolId: 'codex-cli',
    label: 'Codex CLI · Global',
    relPath: 'skills/security-checklist/SKILL.md',
    linked: false,
    reason: 'same-slug',
    similarity: 0.4,
    warnings: ['description was shortened to fit'],
  },
];

const CHECKLIST = {
  key: 'skill.security-checklist',
  kind: 'skill',
  slug: 'security-checklist',
  name: 'Security Checklist',
  description: 'Use when reviewing code for security issues.',
  body: '# Security checklist\n\n- Inputs validated\n',
  canonicalId: SOURCES[0]!.candidateId,
  sources: SOURCES,
  suggestions: [],
};

const AGENT = {
  key: 'agent.code-reviewer',
  kind: 'agent',
  slug: 'code-reviewer',
  name: 'Code Reviewer',
  description: 'Reviews changes.',
  body: 'You are a reviewer.',
  canonicalId: 'claude-code:global|claude|agents/code-reviewer.md',
  sources: [
    {
      ...SOURCES[0]!,
      candidateId: 'claude-code:global|claude|agents/code-reviewer.md',
      relPath: 'agents/code-reviewer.md',
      warnings: [],
    },
  ],
  suggestions: [
    {
      to: 'skill.security-checklist',
      relation: 'equips',
      evidence: 'Always run the security-checklist first.',
    },
  ],
};

beforeEach(() => {
  groups = [CHECKLIST, AGENT];
  scan.mockReset();
  adopt.mockReset();
  plan.mockReset();
  scan.mockImplementation(() =>
    ok({ scanId: 'scan_1', fileCount: 12, durationMs: 40, warnings: [], groups }),
  );
  adopt.mockImplementation((input: { items: { key: string; slug: string }[] }) =>
    ok({
      created: input.items.map((i) => `${i.key.split('.')[0]}.${i.slug}`),
      skipped: [],
      notes: [],
      targetIds: ['claude-code:global'],
    }),
  );
  plan.mockImplementation(() =>
    ok({
      planId: 'p1',
      kind: 'deploy',
      createdAt: '',
      issues: [],
      targets: [
        {
          targetId: 'claude-code:global',
          label: 'Claude Code · Global',
          status: 'ok',
          changes: [],
        },
      ],
    }),
  );

  (window as unknown as { amc: unknown }).amc = {
    library: {
      list: () => ok([]),
      search: () => ok([]),
      graph: () => ok({ edges: [] }),
      templates: () => ok([]),
      validate: () => ok({ issues: [] }),
    },
    system: { status: () => ok({ ready: true, home: 'C:/amc', warnings: [], counts: {} }) },
    settings: { get: () => ok({ theme: 'system', autoApply: 'ask', targetSettings: {} }) },
    tools: { detect: () => ok([]) },
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
          {
            targetId: 'codex-cli:global',
            toolId: 'codex-cli',
            scope: 'global',
            label: 'Codex CLI · Global',
            roots: { codex: 'C:/Users/dev/.codex' },
          },
        ]),
    },
    deploy: {
      matrix: () => ok([]),
      plan,
      apply: () => ok({ deployId: 'd', written: [], deleted: [], skipped: [] }),
    },
    import: { scan, adopt },
    index: { rebuild: () => ok({ items: 0, durationMs: 1 }) },
    on: () => () => {},
  };
});

const open = () =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/import'] })} />);

const startScan = async (user: ReturnType<typeof userEvent.setup>) => {
  open();
  await user.click(await screen.findByRole('button', { name: /Scan these/ }));
  return screen.findByRole('heading', { name: /Review what was found/ });
};

describe('choosing where to look (T1.8.5)', () => {
  it('says plainly that scanning only reads', async () => {
    open();
    expect(await screen.findByText(/Scanning only reads/)).toBeInTheDocument();
  });

  it('scans the targets that are ticked', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('checkbox', { name: 'Codex CLI · Global' }));
    await user.click(screen.getByRole('button', { name: /Scan these/ }));
    await waitFor(() => expect(scan).toHaveBeenCalled());
    expect(scan.mock.calls[0]![0].targetIds).toEqual(['claude-code:global']);
  });
});

describe('reviewing what was found (T1.8.2, T1.8.5)', () => {
  it('shows one item with every tool it was found in', async () => {
    const user = userEvent.setup();
    await startScan(user);
    const row = screen
      .getByRole('checkbox', { name: /Import Security Checklist/ })
      .closest('section')!;
    expect(within(row).getByText('Claude Code · Global')).toBeInTheDocument();
    expect(within(row).getByText('Codex CLI · Global')).toBeInTheDocument();
    expect(within(row).getByText(/same name, different text/)).toBeInTheDocument();
  });

  it('lets you take the content from the other tool instead', async () => {
    const user = userEvent.setup();
    await startScan(user);
    await user.click(screen.getByRole('button', { name: /same name, different text/ }));
    await user.click(screen.getByRole('button', { name: /^Import 2$/ }));
    await waitFor(() => expect(adopt).toHaveBeenCalled());
    const item = adopt.mock.calls[0]![0].items.find(
      (i: { key: string }) => i.key === 'skill.security-checklist',
    );
    expect(item.candidateId).toBe(SOURCES[1]!.candidateId);
  });

  it('surfaces what the parser had to change', async () => {
    const user = userEvent.setup();
    await startScan(user);
    expect(screen.getByText('description was shortened to fit')).toBeInTheDocument();
  });

  it('leaves out an item whose name is already taken, and proposes another', async () => {
    groups = [{ ...CHECKLIST, existingId: 'skill.security-checklist' }];
    const user = userEvent.setup();
    await startScan(user);
    expect(screen.getByRole('checkbox', { name: /Import Security Checklist/ })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /Slug for Security Checklist/ })).toHaveValue(
      'security-checklist-imported',
    );
    expect(screen.getByText(/already in your library/)).toBeInTheDocument();
  });

  it('can go back without importing anything', async () => {
    const user = userEvent.setup();
    await startScan(user);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(await screen.findByRole('button', { name: /Scan these/ })).toBeInTheDocument();
    expect(adopt).not.toHaveBeenCalled();
  });
});

describe('suggested links (T1.8.3)', () => {
  it('shows the evidence and does not apply the link on its own', async () => {
    const user = userEvent.setup();
    await startScan(user);
    expect(screen.getByText(/Always run the security-checklist first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Not linked/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: /^Import 2$/ }));
    await waitFor(() => expect(adopt).toHaveBeenCalled());
    const agent = adopt.mock.calls[0]![0].items.find(
      (i: { key: string }) => i.key === 'agent.code-reviewer',
    );
    expect(agent.links).toEqual([]);
  });

  it('sends the link once it is accepted', async () => {
    const user = userEvent.setup();
    await startScan(user);
    await user.click(screen.getByRole('button', { name: /Not linked/ }));
    await user.click(screen.getByRole('button', { name: /^Import 2$/ }));
    await waitFor(() => expect(adopt).toHaveBeenCalled());
    const agent = adopt.mock.calls[0]![0].items.find(
      (i: { key: string }) => i.key === 'agent.code-reviewer',
    );
    expect(agent.links).toEqual([{ to: 'skill.security-checklist', relation: 'equips' }]);
  });
});

describe('after importing (T1.8.4)', () => {
  it('reports what landed and offers to record what is already installed', async () => {
    const user = userEvent.setup();
    await startScan(user);
    await user.click(screen.getByRole('button', { name: /^Import 2$/ }));

    expect(await screen.findByRole('heading', { name: 'Imported' })).toBeInTheDocument();
    expect(screen.getByText(/Your tool folders were not touched/)).toBeInTheDocument();
    expect(screen.getByText('skill.security-checklist')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Record what is already installed/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Nothing is written until you apply/)).toBeInTheDocument();
    await waitFor(() => expect(plan).toHaveBeenCalled());
  });
});
