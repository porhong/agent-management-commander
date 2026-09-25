import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const ok = (value: unknown) => Promise.resolve({ ok: true, value });

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
  {
    id: 'command.review-pr',
    kind: 'command',
    slug: 'review-pr',
    name: 'Review PR',
    version: '1.0.0',
    description: 'Review a pull request.',
    tags: [],
    updatedAt: null,
  },
];

const rebuild = vi.fn(() => ok({ items: 3, durationMs: 4 }));
let theme = 'system';

beforeEach(() => {
  rebuild.mockClear();
  theme = 'system';
  delete document.documentElement.dataset['theme'];
  (window as unknown as { amc: unknown }).amc = {
    library: {
      list: () => ok(ROWS),
      search: () => ok([]),
      graph: () => ok({ edges: [] }),
      templates: () => ok([]),
    },
    system: {
      status: () =>
        ok({
          ready: true,
          home: 'C:/Users/dev/.amc',
          warnings: [],
          counts: { items: 3, targets: 2 },
        }),
    },
    settings: { get: () => ok({ theme }) },
    deploy: { matrix: () => ok([]) },
    tools: { detect: () => ok([]) },
    index: { rebuild },
    on: () => () => {},
  };
});

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/library/skill']}>
      <App />
    </MemoryRouter>,
  );

describe('app shell (T1.6.1)', () => {
  it('shows the library sections with live counts and the AMC home', async () => {
    renderApp();
    const sidebar = (await screen.findByRole('link', { name: /Skills/ })).closest('aside')!;
    expect(within(sidebar).getByRole('link', { name: /Agents/ })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: /Commands/ })).toBeInTheDocument();
    // One item of each kind in the fixture.
    await waitFor(() =>
      expect(within(sidebar).getByRole('link', { name: /^Skills\s*1$/ })).toBeInTheDocument(),
    );
    expect(within(sidebar).getByText('C:/Users/dev/.amc')).toBeInTheDocument();
  });

  it('navigates between kinds with the keyboard', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('link', { name: /Agents/ }));
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
  });

  it('follows the OS theme unless settings pick one', async () => {
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBeUndefined());
    theme = 'dark';
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
  });
});

describe('ipc calls', () => {
  it('calls channels that take no input with no argument at all', async () => {
    // `z.void()` in the contract rejects null, so passing one silently breaks every such screen.
    const seen: unknown[][] = [];
    const record =
      (value: unknown) =>
      (...args: unknown[]) => {
        seen.push(args);
        return ok(value);
      };
    (window as unknown as { amc: Record<string, unknown> }).amc = {
      library: {
        list: () => ok(ROWS),
        search: () => ok([]),
        graph: () => ok({ edges: [] }),
        templates: () => ok([]),
      },
      system: {
        status: record({
          ready: true,
          home: 'C:/x',
          warnings: [],
          counts: { items: 3, targets: 2 },
        }),
      },
      settings: { get: record({ theme: 'system' }) },
      deploy: { matrix: record([]) },
      tools: { detect: record([]) },
      index: { rebuild },
      on: () => () => {},
    };
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByText(/3 items across 2 targets/);
    expect(seen.length).toBeGreaterThan(0);
    for (const args of seen) expect(args.filter((a) => a !== undefined)).toEqual([]);
  });
});

describe('command palette (T1.6.2)', () => {
  it('opens with Ctrl+K, finds items, and navigates to one', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Security Checklist');

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog');
    await user.type(within(palette).getByPlaceholderText('Search items and actions'), 'review pr');
    await user.keyboard('{Enter}');

    // The command from the palette, not the skill list behind it.
    expect(await screen.findByRole('heading', { name: 'Item editor' })).toBeInTheDocument();
  });

  it('runs an action and closes', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog');
    await user.type(within(palette).getByPlaceholderText('Search items and actions'), 'rebuild');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(rebuild).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText('Search items and actions')).not.toBeInTheDocument();
  });

  it('starts a new item of the chosen kind', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search items and actions'), 'new agent');
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'New agent' })).toBeInTheDocument();
  });

  it('says so when nothing matches, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search items and actions'), 'zzzzz');
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Search items and actions')).not.toBeInTheDocument(),
    );
  });
});
