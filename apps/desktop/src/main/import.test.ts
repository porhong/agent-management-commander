import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { NodeFs as Fs, type AdapterHost, type NodeFs } from '@amc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppServices, type AppServices } from './app-services';
import { createHandlers, type HandlerMap } from './handlers';

const FIXTURES = resolve(__dirname, '../../../../fixtures');

let home: string;
let services: AppServices;
let h: HandlerMap;

const host = (dir: string): AdapterHost => ({
  fs: new Fs() as NodeFs,
  home: dir,
  env: {},
  runVersion: async () => null,
});

/** Every file under `dir`, as `relative path → sha256`. */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        out[relative(dir, path).replace(/\\/g, '/')] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex');
      }
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir);
  return out;
}

const toolFingerprint = () => ({
  ...fingerprint(join(home, '.claude')),
  ...fingerprint(join(home, '.codex')),
  ...fingerprint(join(home, '.agents')),
});

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'amc-import-'));
  // The same items really do live in both tools in the fixtures, which is the point of M1.8.
  cpSync(join(FIXTURES, 'claude-code', 'global'), join(home, '.claude'), { recursive: true });
  cpSync(join(FIXTURES, 'codex-cli', 'codex-home'), join(home, '.codex'), { recursive: true });
  cpSync(join(FIXTURES, 'codex-cli', 'agents-home'), join(home, '.agents'), { recursive: true });

  services = await createAppServices({
    home: join(home, '.amc'),
    host: host(home),
    indexPath: ':memory:',
    emit: () => {},
  });
  h = createHandlers({
    services,
    dialog: { pickFolder: async () => null },
    probe: () => ({
      versions: { electron: '44', node: '24', chrome: '142' },
      sqlite: { ok: true, version: '3', fts5: true },
    }),
  });
});

afterEach(() => {
  services.close();
  rmSync(home, { recursive: true, force: true });
});

describe('import scan (T1.8.1, T1.8.2)', () => {
  it('finds the same skill in both tools as one item with two sources', async () => {
    const scan = await h['import.scan']({});
    const checklist = scan.groups.find((g) => g.key === 'skill.security-checklist');

    expect(checklist, 'security-checklist should be one group').toBeDefined();
    expect(checklist!.sources.map((s) => s.toolId).sort()).toEqual(['claude-code', 'codex-cli']);
    // The two tools' copies have drifted apart, and the UI is told which is which.
    expect(checklist!.sources.some((s) => s.reason === 'same-slug')).toBe(true);
    expect(scan.groups.filter((g) => g.slug === 'security-checklist')).toHaveLength(1);
    expect(scan.fileCount).toBeGreaterThan(0);
  });

  it('reads the agent and command the tools share, without duplicating them', async () => {
    const scan = await h['import.scan']({});
    for (const key of ['agent.code-reviewer', 'command.review-pr']) {
      const group = scan.groups.find((g) => g.key === key);
      expect(group, key).toBeDefined();
      expect(scan.groups.filter((g) => g.key === key)).toHaveLength(1);
    }
  });

  it('changes nothing on disk', async () => {
    const before = toolFingerprint();
    await h['import.scan']({});
    expect(toolFingerprint()).toEqual(before);
  });

  it('refuses to adopt against a scan it no longer has', async () => {
    await expect(
      h['import.adopt']({ scanId: 'scan_nope', items: [{ key: 'skill.x', slug: 'x' }] }),
    ).rejects.toThrow(/no longer available/);
  });
});

describe('adopt (T1.8.4, S6)', () => {
  it('writes the library and not one byte of any tool folder', async () => {
    const scan = await h['import.scan']({});
    const before = toolFingerprint();

    const result = await h['import.adopt']({
      scanId: scan.scanId,
      items: scan.groups.map((g) => ({ key: g.key, slug: g.slug })),
    });

    expect(result.created.length).toBeGreaterThan(0);
    expect(toolFingerprint()).toEqual(before);
    expect(result.targetIds).toContain('claude-code:global');
  });

  it('puts the imported item in the library, body and all', async () => {
    const scan = await h['import.scan']({});
    const group = scan.groups.find((g) => g.key === 'skill.security-checklist')!;
    await h['import.adopt']({
      scanId: scan.scanId,
      items: [{ key: group.key, slug: group.slug }],
    });

    const item = await h['library.get']({ id: 'skill.security-checklist' });
    expect(item.body).toBe(group.body);
    expect(item.manifest['description']).toBe(group.description);
  });

  it('carries over the references the native file already declared', async () => {
    // The Claude agent fixture lists its skills in frontmatter; importing must not lose them.
    const scan = await h['import.scan']({});
    await h['import.adopt']({
      scanId: scan.scanId,
      items: [
        { key: 'skill.security-checklist', slug: 'security-checklist' },
        { key: 'skill.style-guide', slug: 'style-guide' },
        { key: 'agent.code-reviewer', slug: 'code-reviewer' },
      ],
    });

    const agent = await h['library.get']({ id: 'agent.code-reviewer' });
    // Claude lists an agent's skills as always-loaded, and that is carried over, not flattened.
    expect(agent.manifest['skills']).toEqual([
      { ref: 'skill.security-checklist', mode: 'always' },
      { ref: 'skill.style-guide', mode: 'always' },
    ]);
  });

  it('follows a slug the user changed, and says so when a reference cannot be kept', async () => {
    const scan = await h['import.scan']({});
    const result = await h['import.adopt']({
      scanId: scan.scanId,
      items: [
        { key: 'skill.security-checklist', slug: 'checklist-renamed' },
        // style-guide is deliberately left out, so that reference has nowhere to go.
        { key: 'agent.code-reviewer', slug: 'code-reviewer' },
      ],
    });

    const agent = await h['library.get']({ id: 'agent.code-reviewer' });
    expect(agent.manifest['skills']).toEqual([{ ref: 'skill.checklist-renamed', mode: 'always' }]);
    expect(result.notes.join(' ')).toMatch(/style-guide/);
  });

  it('applies a link the user accepted, and nothing they did not', async () => {
    const scan = await h['import.scan']({});
    // These fixtures declare their references in frontmatter, so there is nothing to guess at:
    // suggestions only ever come from one item's prose naming another.
    expect(scan.groups.flatMap((g) => g.suggestions)).toEqual([]);

    const declined = await h['import.adopt']({
      scanId: scan.scanId,
      items: [
        { key: 'agent.code-reviewer', slug: 'code-reviewer' },
        { key: 'command.review-pr', slug: 'review-pr', links: [] },
      ],
    });
    expect(declined.created).toContain('command.review-pr');
    expect((await h['library.get']({ id: 'command.review-pr' })).manifest['agent']).toBeUndefined();

    const second = await h['import.scan']({});
    await h['import.adopt']({
      scanId: second.scanId,
      items: [
        { key: 'agent.code-reviewer', slug: 'reviewer-two' },
        {
          key: 'command.review-pr',
          slug: 'review-two',
          links: [{ to: 'agent.code-reviewer', relation: 'uses-agent' }],
        },
      ],
    });
    expect((await h['library.get']({ id: 'command.review-two' })).manifest['agent']).toBe(
      'agent.reviewer-two',
    );
  });

  it('recording ownership afterwards is a plan that rewrites no existing file', async () => {
    const scan = await h['import.scan']({});
    const skills = scan.groups.filter((g) => g.kind === 'skill');
    await h['import.adopt']({
      scanId: scan.scanId,
      items: skills.map((g) => ({ key: g.key, slug: g.slug })),
    });

    const before = toolFingerprint();
    const plan = await h['deploy.plan']({
      selections: [
        {
          target: { toolId: 'claude-code', scope: 'global' },
          items: skills.map((g) => `skill.${g.slug}`),
        },
      ],
    });

    // Anything that round-trips exactly is adopted in place rather than rewritten.
    const adopted = plan.targets[0]!.changes.filter((c) => c.op === 'unchanged');
    expect(adopted.length).toBeGreaterThan(0);

    const resolutions = Object.fromEntries(
      plan.targets[0]!.changes.filter((c) => c.op === 'conflict').map((c) => [
        c.id,
        'skip' as const,
      ]),
    );
    await h['deploy.apply']({ planId: plan.planId, resolutions });

    const after = toolFingerprint();
    // The lockfile is new; every file that was already there is untouched.
    for (const [path, hash] of Object.entries(before)) expect(after[path], path).toBe(hash);
    const added = Object.keys(after).filter((p) => !(p in before));
    expect(added).toEqual(['.amc-lock.json']);
  });
});
