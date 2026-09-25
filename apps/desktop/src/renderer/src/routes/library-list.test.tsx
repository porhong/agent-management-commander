import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryList } from './library-list';

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

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  kind: id.split('.')[0]!,
  slug: id.split('.')[1]!,
  name: id.split('.')[1]!.replace(/-/g, ' '),
  version: '1.0.0',
  description: `About ${id}`,
  tags: [],
  updatedAt: null,
  ...over,
});

const ok = (value: unknown) => Promise.resolve({ ok: true, value });

let rows: Row[];
let edges: Array<{ from: string; to: string; relation: string; mode: string | null }>;
let matrix: Array<{
  itemId: string;
  targetId: string;
  deployedVersion: string;
  libraryVersion: string | null;
  status: string;
}>;
const deleted: string[] = [];

function installApi() {
  deleted.length = 0;
  const api = {
    library: {
      list: (input: { kind?: string }) =>
        ok(rows.filter((r) => !input.kind || r.kind === input.kind)),
      search: (input: { query: string }) =>
        ok(
          rows.filter((r) =>
            `${r.name} ${r.description}`.toLowerCase().includes(input.query.toLowerCase()),
          ),
        ),
      graph: () => ok({ edges }),
      templates: () => ok([]),
      delete: (input: { id: string }) => {
        deleted.push(input.id);
        rows = rows.filter((r) => r.id !== input.id);
        return ok({ deleted: true });
      },
      create: () => ok({ manifest: { id: 'skill.new' }, body: '', files: {} }),
    },
    deploy: { matrix: () => ok(matrix) },
    on: () => () => {},
  };
  (window as unknown as { amc: unknown }).amc = api;
}

const renderList = (kind = 'skill') =>
  render(
    <MemoryRouter initialEntries={[`/library/${kind}`]}>
      <Routes>
        <Route path="/library/:kind" element={<LibraryList />} />
        <Route path="/item/:id" element={<p>editor for item</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  rows = [
    row('skill.security-checklist', {
      name: 'Security Checklist',
      tags: ['security'],
      version: '1.3.0',
    }),
    row('skill.style-guide', { name: 'Style Guide', tags: ['style'] }),
    row('agent.code-reviewer', { name: 'Code Reviewer' }),
  ];
  edges = [
    {
      from: 'agent.code-reviewer',
      to: 'skill.security-checklist',
      relation: 'equips',
      mode: 'always',
    },
  ];
  matrix = [
    {
      itemId: 'skill.security-checklist',
      targetId: 'claude-code:global',
      deployedVersion: '1.2.0',
      libraryVersion: '1.3.0',
      status: 'outdated',
    },
  ];
  installApi();
});

describe('library list (T1.6.3)', () => {
  it('shows only the route’s kind, with version, references, and deploy status', async () => {
    renderList();
    expect(await screen.findByText('Security Checklist')).toBeInTheDocument();
    expect(screen.getByText('Style Guide')).toBeInTheDocument();
    expect(screen.queryByText('Code Reviewer')).not.toBeInTheDocument();
    expect(screen.getByText('1.3.0')).toBeInTheDocument();
    // One agent equips it, and it is deployed to one target but out of date.
    expect(
      screen.getByTitle('The library has a newer version than what is deployed.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 target')).toBeInTheDocument();
  });

  it('filters by search and by tag, and offers a way back', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Security Checklist');

    await user.type(screen.getByLabelText('Search skills'), 'style');
    await waitFor(() => expect(screen.queryByText('Security Checklist')).not.toBeInTheDocument());
    expect(screen.getByText('Style Guide')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search skills'));
    await user.selectOptions(await screen.findByLabelText('Filter by tag'), 'security');
    await waitFor(() => expect(screen.queryByText('Style Guide')).not.toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Filter by tag'), '');
    expect(await screen.findByText('Style Guide')).toBeInTheDocument();
  });

  it('explains an empty search instead of showing a blank table', async () => {
    const user = userEvent.setup();
    renderList();
    await user.type(await screen.findByLabelText('Search skills'), 'nothing matches this');
    expect(await screen.findByText('Nothing matches that search.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Security Checklist')).toBeInTheDocument();
  });

  it('invites a first item when the library is empty', async () => {
    rows = [];
    renderList();
    expect(await screen.findByText('No skills yet')).toBeInTheDocument();
    expect(screen.getByText(/A skill is a piece of knowledge/)).toBeInTheDocument();
  });

  it('opens an item with the keyboard', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Security Checklist');
    const rowEl = screen.getByText('Security Checklist').closest('[role="button"]')!;
    (rowEl as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('editor for item')).toBeInTheDocument();
  });

  it('keeps referenced items when deleting a selection, and says so', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Security Checklist');

    await user.click(screen.getByLabelText('Select Security Checklist'));
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    // It is equipped by an agent, so deleting is refused before it reaches main.
    expect(screen.getByText(/used by other items and will be kept/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();

    await user.click(screen.getByLabelText('Select Style Guide'));
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(deleted).toEqual(['skill.style-guide']));
  });

  it('virtualizes long lists instead of rendering every row', async () => {
    rows = Array.from({ length: 1000 }, (_, i) => row(`skill.s${i}`, { name: `Skill ${i}` }));
    edges = [];
    matrix = [];
    const started = performance.now();
    renderList();
    await screen.findByText('Skill 0');
    expect(performance.now() - started).toBeLessThan(2000);
    const list = screen.getByText('Skill 0').closest('.relative')!;
    expect(within(list as HTMLElement).getAllByRole('button').length).toBeLessThan(80);
    expect(screen.getByText('1000')).toBeInTheDocument();
  });
});

describe('new item dialog (J2)', () => {
  it('derives a slug from the name and explains what the description is for', async () => {
    const user = userEvent.setup();
    const create = vi.fn(() =>
      ok({ manifest: { id: 'skill.deploy-checklist' }, body: '', files: {} }),
    );
    installApi();
    (window as unknown as { amc: { library: Record<string, unknown> } }).amc.library['create'] =
      create;

    renderList();
    await user.click(await screen.findByRole('button', { name: /New skill/ }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/), 'Deploy Checklist');
    expect(within(dialog).getByLabelText(/Slug/)).toHaveValue('deploy-checklist');
    expect(
      within(dialog).getByText(/Tools read this to decide when to use the skill/),
    ).toBeInTheDocument();

    // The description is required, so creating stays disabled until it is filled in.
    expect(within(dialog).getByRole('button', { name: /Create skill/ })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Description/), 'Use before every release.');
    await user.click(within(dialog).getByRole('button', { name: /Create skill/ }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'skill',
          slug: 'deploy-checklist',
          name: 'Deploy Checklist',
        }),
      ),
    );
    expect(await screen.findByText('editor for item')).toBeInTheDocument();
  });
});
