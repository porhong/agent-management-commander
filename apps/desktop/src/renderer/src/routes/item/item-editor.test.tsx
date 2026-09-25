import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../App';

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const fail = (message: string) => Promise.resolve({ ok: false, error: { code: 'BAD', message } });

type Item = { manifest: Record<string, unknown>; body: string; files: Record<string, string> };

let items: Record<string, Item>;
let issues: unknown[];
let previewInputs: { id: string; draft?: { manifest: Record<string, unknown>; body: string } }[];
const update = vi.fn();
const rename = vi.fn();
const restore = vi.fn();

const SKILL = (): Item => ({
  manifest: {
    id: 'skill.security-checklist',
    kind: 'skill',
    name: 'Security Checklist',
    slug: 'security-checklist',
    version: '1.3.0',
    description: 'Use when reviewing code for security issues.',
    tags: ['security'],
    triggers: [],
    dependsOn: [],
  },
  body: '# Security checklist\n\n- [ ] Inputs validated\n',
  files: {},
});

const AGENT = (): Item => ({
  manifest: {
    id: 'agent.code-reviewer',
    kind: 'agent',
    name: 'Code Reviewer',
    slug: 'code-reviewer',
    version: '2.0.0',
    description: 'Reviews changes.',
    tags: [],
    skills: [
      { ref: 'skill.security-checklist', mode: 'on-demand' },
      { ref: 'skill.style-guide', mode: 'always' },
    ],
    delegatesTo: [],
  },
  body: 'You are a senior code reviewer.\n',
  files: {},
});

const COMMAND = (): Item => ({
  manifest: {
    id: 'command.review-pr',
    kind: 'command',
    name: 'Review PR',
    slug: 'review-pr',
    version: '1.0.0',
    description: 'Review a pull request.',
    tags: [],
    arguments: [],
    preloadSkills: [],
  },
  body: 'Review pull request {{pr}}.\n',
  files: {},
});

const rowsOf = () =>
  Object.values(items).map((i) => ({
    id: i.manifest['id'],
    kind: i.manifest['kind'],
    slug: i.manifest['slug'],
    name: i.manifest['name'],
    version: i.manifest['version'],
    description: i.manifest['description'],
    tags: i.manifest['tags'] ?? [],
    updatedAt: null,
  }));

beforeEach(() => {
  items = {
    'skill.security-checklist': SKILL(),
    'skill.style-guide': {
      ...SKILL(),
      manifest: {
        ...SKILL().manifest,
        id: 'skill.style-guide',
        slug: 'style-guide',
        name: 'Style Guide',
      },
    },
    'agent.code-reviewer': AGENT(),
    'command.review-pr': COMMAND(),
  };
  issues = [];
  previewInputs = [];
  update.mockReset();
  rename.mockReset();
  restore.mockReset();
  update.mockImplementation(
    (input: { id: string; fields?: Record<string, unknown>; body?: string }) => {
      const current = items[input.id]!;
      const next: Item = {
        manifest: { ...current.manifest, ...input.fields, version: '1.3.1' },
        body: input.body ?? current.body,
        files: {},
      };
      items[input.id] = next;
      return ok(next);
    },
  );
  rename.mockImplementation(() => ok(items['skill.security-checklist']));
  restore.mockImplementation(() => ok(items['skill.security-checklist']));

  (window as unknown as { amc: unknown }).amc = {
    library: {
      list: (input?: { kind?: string }) =>
        ok(rowsOf().filter((r) => !input?.kind || r.kind === input.kind)),
      search: () => ok([]),
      graph: () => ok({ edges: [] }),
      templates: () => ok([]),
      get: (input: { id: string }) =>
        items[input.id] ? ok(items[input.id]) : fail(`No item ${input.id}`),
      at: (input: { id: string }) => ok({ ...items[input.id]!, body: 'An older body.\n' }),
      relations: () =>
        ok({
          uses: [{ id: 'skill.security-checklist', relation: 'equips', mode: 'always' }],
          usedBy: [{ id: 'command.review-pr', relation: 'uses-agent', mode: null }],
        }),
      history: () =>
        ok([
          {
            rev: 'b7d1c2a0',
            summary: 'amc: update (1.3.0)',
            timestamp: '2026-09-20T09:00:00.000Z',
          },
        ]),
      validate: () => ok({ issues }),
      update,
      rename,
      restore,
      duplicate: () => ok(items['skill.security-checklist']),
      delete: () => ok({ deleted: true }),
    },
    system: {
      status: () =>
        ok({ ready: true, home: 'C:/amc', warnings: [], counts: { items: 4, targets: 1 } }),
    },
    settings: { get: () => ok({ theme: 'system', onboarded: true }) },
    deploy: {
      matrix: () => ok([]),
      plan: () => ok({ planId: 'p1', kind: 'deploy', createdAt: '', issues: [], targets: [] }),
    },
    tools: {
      detect: () =>
        ok([
          {
            toolId: 'claude-code',
            displayName: 'Claude Code',
            installed: true,
            roots: { claude: 'C:/Users/dev/.claude' },
            notes: [],
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
    compile: {
      preview: (input: {
        id: string;
        draft?: { manifest: Record<string, unknown>; body: string };
      }) => {
        previewInputs.push(input);
        const source = input.draft ?? items[input.id]!;
        return ok({
          files: [
            {
              root: 'claude',
              relPath: `skills/${String(source.manifest['slug'])}/SKILL.md`,
              content: `---\nname: ${String(source.manifest['slug'])}\n---\n\n${source.body}`,
              binary: false,
              adaptations: [
                { code: 'no-triggers', message: 'Triggers were folded into the description.' },
              ],
            },
          ],
        });
      },
    },
    index: { rebuild: () => ok({ items: 4, durationMs: 1 }) },
    on: () => () => {},
  };
});

/**
 * The document the manifest editor holds. jsdom has no layout, so CodeMirror renders only part
 * of the text; its state is the honest place to read what the user would see.
 */
const manifestText = async (container: HTMLElement): Promise<string> => {
  const { EditorView } = await import('@codemirror/view');
  return EditorView.findFromDOM(container.querySelector('.cm-editor')!)!.state.doc.toString();
};

const open = (id: string) =>
  render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/item/${id}`] })} />,
  );

describe('item editor: details and saving (T1.6.4)', () => {
  it('shows the item and its compiled file side by side', async () => {
    open('skill.security-checklist');
    expect(await screen.findByRole('heading', { name: 'Security Checklist' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('security-checklist')).toBeInTheDocument();
    await screen.findByText('skills/security-checklist/SKILL.md');
    expect(screen.getByText(/Triggers were folded into the description/)).toBeInTheDocument();
  });

  it('marks edits unsaved and writes them through library.update', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    const name = await screen.findByDisplayValue('Security Checklist');

    await user.clear(name);
    await user.type(name, 'Security Review');
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![0].fields.name).toBe('Security Review');
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
  });

  it('reverts to the saved version', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    const name = await screen.findByDisplayValue('Security Checklist');
    await user.type(name, ' v2');
    await user.click(await screen.findByRole('button', { name: /Revert/ }));
    expect(await screen.findByDisplayValue('Security Checklist')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('renames through library.rename, because the id must not change', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    const slug = await screen.findByDisplayValue('security-checklist');
    await user.clear(slug);
    await user.type(slug, 'security-review');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        id: 'skill.security-checklist',
        slug: 'security-review',
      }),
    );
  });
});

describe('compiled preview (T1.6.6)', () => {
  it('compiles the unsaved draft, so the preview matches what you typed', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    await screen.findByText('skills/security-checklist/SKILL.md');

    const description = await screen.findByDisplayValue(/Use when reviewing code/);
    await user.clear(description);
    await user.type(description, 'Brand new description.');

    await waitFor(() =>
      expect(previewInputs.at(-1)?.draft?.manifest['description']).toBe('Brand new description.'),
    );
    // Nothing was written to get there.
    expect(update).not.toHaveBeenCalled();
  });

  it('says so when the item is set to skip the tool', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    await user.click(await screen.findByRole('button', { name: 'Tools & model' }));
    await user.click(await screen.findByRole('checkbox', { name: /Claude Code/ }));
    expect(await screen.findByText(/set to skip this tool/)).toBeInTheDocument();
  });
});

describe('raw YAML mode (T1.6.5)', () => {
  it('carries form edits into YAML and back', async () => {
    const user = userEvent.setup();
    const { container } = open('skill.security-checklist');
    const name = await screen.findByDisplayValue('Security Checklist');
    await user.clear(name);
    await user.type(name, 'Renamed In Form');

    await user.click(screen.getByRole('button', { name: 'YAML' }));
    await screen.findByRole('textbox', { name: 'Manifest, as YAML' });
    expect(await manifestText(container)).toContain('name: Renamed In Form');

    await user.click(screen.getByRole('button', { name: 'Form' }));
    expect(await screen.findByDisplayValue('Renamed In Form')).toBeInTheDocument();
  });

  it('refuses to go back to the form while the YAML cannot be read', async () => {
    const user = userEvent.setup();
    const { container } = open('skill.security-checklist');
    await screen.findByDisplayValue('Security Checklist');
    await user.click(screen.getByRole('button', { name: 'YAML' }));

    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'name: [unclosed\n' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't valid YAML/);
    await user.click(screen.getByRole('button', { name: 'Form' }));
    // Still in YAML mode: the form would have a Name field.
    expect(screen.queryByDisplayValue('Security Checklist')).not.toBeInTheDocument();
  });
});

describe('agent skills (T1.6.4)', () => {
  it('reorders equipped skills and changes how they load', async () => {
    const user = userEvent.setup();
    open('agent.code-reviewer');
    await user.click(await screen.findByRole('button', { name: 'Skills' }));

    await user.selectOptions(
      await screen.findByRole('combobox', { name: /How Security Checklist is loaded/ }),
      'always',
    );
    await user.click(screen.getByRole('button', { name: /Move Style Guide up/ }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls.at(-1)![0].fields.skills).toEqual([
      { ref: 'skill.style-guide', mode: 'always' },
      { ref: 'skill.security-checklist', mode: 'always' },
    ]);
  });
});

describe('command arguments (T1.6.4)', () => {
  it('adds a named argument', async () => {
    const user = userEvent.setup();
    open('command.review-pr');
    await user.click(await screen.findByRole('button', { name: 'Arguments' }));
    await user.click(screen.getByRole('button', { name: /Add argument/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Argument 1 name' }), 'pr');
    await user.click(screen.getByRole('checkbox', { name: 'Argument 1 is required' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls.at(-1)![0].fields.arguments).toEqual([{ name: 'pr', required: true }]);
  });
});

describe('validation surface (T1.6.7)', () => {
  it('shows the item issues inline and applies the rule fix', async () => {
    issues = [
      {
        ruleId: 'description-length',
        severity: 'warning',
        message: 'Description is longer than Claude Code allows.',
        itemId: 'skill.security-checklist',
        path: 'description',
        blocking: false,
        fix: {
          label: 'Shorten it',
          itemId: 'skill.security-checklist',
          fields: { description: 'Short.' },
        },
      },
    ];
    const user = userEvent.setup();
    open('skill.security-checklist');
    expect(
      await screen.findByText('Description is longer than Claude Code allows.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Issues/ }));
    await user.click(await screen.findByRole('button', { name: /Shorten it/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: 'skill.security-checklist',
        fields: { description: 'Short.' },
      }),
    );
  });

  it('counts blocking issues in the tab bar', async () => {
    issues = [
      {
        ruleId: 'ref-broken',
        severity: 'error',
        message: 'References a skill that is not in the library.',
        itemId: 'skill.security-checklist',
        blocking: true,
      },
    ];
    open('skill.security-checklist');
    expect(await screen.findByText(/1 issue blocks deploying/)).toBeInTheDocument();
  });
});

describe('relations and history (T1.6.8)', () => {
  it('lists what the item uses and what uses it', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    await user.click(await screen.findByRole('button', { name: 'Relations' }));
    expect(await screen.findByText('is equipped with')).toBeInTheDocument();
    expect(screen.getByText('runs')).toBeInTheDocument();
  });

  it('diffs a revision before restoring it', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    await user.click(await screen.findByRole('button', { name: 'History' }));
    await user.click(await screen.findByText('amc: update (1.3.0)'));

    expect(await screen.findByText('An older body.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Restore this version/ }));
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ id: 'skill.security-checklist', rev: 'b7d1c2a0' }),
    );
  });
});

describe('unsaved changes guard (T1.6.4)', () => {
  it('asks before navigating away, and can save on the way out', async () => {
    const user = userEvent.setup();
    open('skill.security-checklist');
    const name = await screen.findByDisplayValue('Security Checklist');
    await user.type(name, ' edited');

    await user.click(screen.getByRole('link', { name: /Skills/ }));
    const dialog = await screen.findByRole('dialog', { name: /unsaved changes/i });
    await user.click(within(dialog).getByRole('button', { name: /Save and leave/ }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeInTheDocument();
  });
});

describe('deep links', () => {
  it('opens straight into YAML mode with the manifest already in it', async () => {
    const { container } = render(
      <RouterProvider
        router={createMemoryRouter(routes, {
          initialEntries: ['/item/skill.security-checklist?mode=yaml'],
        })}
      />,
    );
    await screen.findByRole('textbox', { name: 'Manifest, as YAML' });
    await waitFor(async () =>
      expect(await manifestText(container)).toContain('name: Security Checklist'),
    );
  });

  it('opens a named tab', async () => {
    render(
      <RouterProvider
        router={createMemoryRouter(routes, {
          initialEntries: ['/item/agent.code-reviewer?tab=skills'],
        })}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Equipped skills' })).toBeInTheDocument();
  });
});
