import { join } from 'node:path';
import {
  buildGraph,
  MemFs,
  parseFrontmatter,
  parseManifest,
  resolveClosure,
  type LibraryItem,
  type Target,
} from '@amc/core';
import { describe, expect, it } from 'vitest';
import { compileItem, createClaudeCodeAdapter, parseGroup } from './index';

function mk(id: string, fields: Record<string, unknown> = {}, body = ''): LibraryItem {
  const [kind, slug] = id.split('.') as [string, string];
  return {
    manifest: parseManifest({
      id,
      kind,
      slug,
      name: slug,
      description: `About ${slug}.`,
      ...fields,
    }),
    body,
    files: {},
  };
}

const compileOne = (items: LibraryItem[], id: string) =>
  compileItem(resolveClosure(buildGraph(items), [id]).at(-1)!);

const fm = (content: string | Buffer) => parseFrontmatter(content.toString());

describe('Claude Code compile (T1.3.3)', () => {
  it('uses the current slug of a renamed skill, not the id', () => {
    const renamed = mk('skill.sec', { slug: 'security-checklist' });
    const agent = mk('agent.rev', { skills: [{ ref: 'skill.sec', mode: 'always' }] });
    const [file] = compileOne([renamed, agent], 'agent.rev');
    expect(file!.root).toBe('claude');
    expect(fm(file!.content).data['skills']).toEqual(['security-checklist']);
  });

  it('maps tiers and permissions, and lists delegates in the prompt', () => {
    const items = [
      mk('agent.helper'),
      mk(
        'agent.lead',
        {
          model: { preferred: 'fast' },
          tools: { allow: ['read', 'search', 'shell'], deny: ['write'] },
          delegatesTo: ['agent.helper'],
        },
        'Lead.',
      ),
    ];
    const [file] = compileOne(items, 'agent.lead');
    const parsed = fm(file!.content);
    expect(parsed.data).toMatchObject({
      name: 'lead',
      model: 'haiku',
      tools: 'Read, Grep, Glob, Bash',
      disallowedTools: 'Write',
    });
    expect(parsed.body).toContain('## Subagents you may delegate to\n\n- helper: About helper.');
    expect(file!.adaptations.map((a) => a.code)).toEqual(['agent.delegates.prompt']);
  });

  it('compiles triggers to when_to_use', () => {
    const [file] = compileOne(
      [mk('skill.s', { triggers: ['review', 'audit'] }, 'Body')],
      'skill.s',
    );
    expect(fm(file!.content).data['when_to_use']).toBe('Use when: review; audit');
    expect(file!.adaptations).toEqual([]);
  });

  it('compiles named args natively and positions 0-based', () => {
    const items = [
      mk('skill.sec'),
      mk('agent.rev', { compat: { overrides: { 'claude-code': { name: 'Reviewer' } } } }),
      mk(
        'command.review',
        {
          arguments: [{ name: 'pr' }, { name: 'arg1' }],
          agent: 'agent.rev',
          preloadSkills: ['skill.sec'],
        },
        'Review {{pr}}, first word {{arg1}}, all {{args}}.',
      ),
    ];
    const [file] = compileOne(items, 'command.review');
    const parsed = fm(file!.content);
    expect(parsed.data).toEqual({
      description: 'About review.',
      arguments: ['pr'],
      context: 'fork',
      agent: 'Reviewer',
    });
    expect(parsed.body).toBe(
      'Use these skills for this task:\n\n- /sec: About sec.\n\nReview $pr, first word $0, all $ARGUMENTS.',
    );
    expect(file!.adaptations.map((a) => a.code)).toEqual([
      'command.agent.fork',
      'command.preload.prompt',
    ]);
  });

  it('round-trips native named arguments', () => {
    const native =
      '---\ndescription: Fix an issue\narguments: [issue, branch]\n---\n\nFix $issue on $branch ($0).\n';
    const { item } = parseGroup({
      kind: 'command',
      root: 'claude',
      entry: 'commands/fix.md',
      files: [{ relPath: 'commands/fix.md', content: Buffer.from(native) }],
      linked: false,
    });
    expect(item.body).toBe('Fix {{issue}} on {{branch}} ({{arg1}}).\n');
    expect(item.manifest.kind === 'command' && item.manifest.arguments.map((a) => a.name)).toEqual([
      'issue',
      'branch',
      'arg1',
    ]);
    const [file] = compileItem({ item, refs: [] });
    expect(file!.content).toBe(
      '---\ndescription: Fix an issue\narguments:\n  - issue\n  - branch\n---\n\nFix $issue on $branch ($0).\n',
    );
  });
});

describe('Claude Code targets and detection (T1.3.2, T1.3.7)', () => {
  const home = join('/', 'home', 'u');
  const project: Target = {
    toolId: 'claude-code',
    scope: 'project',
    root: join('/', 'work', 'api'),
  };

  it('respects CLAUDE_CONFIG_DIR and keeps project roots inside the project', () => {
    const a = createClaudeCodeAdapter({ fs: new MemFs(), home, env: {} });
    expect(a.paths({ toolId: 'claude-code', scope: 'global' })).toEqual({
      claude: join(home, '.claude'),
    });
    expect(a.paths(project)).toEqual({ claude: join('/', 'work', 'api', '.claude') });
    const relocated = createClaudeCodeAdapter({
      fs: new MemFs(),
      home,
      env: { CLAUDE_CONFIG_DIR: join('/', 'cfg') },
    });
    expect(relocated.paths({ toolId: 'claude-code', scope: 'global' })).toEqual({
      claude: join('/', 'cfg'),
    });
  });

  it('detects the folder without the CLI on PATH', async () => {
    const fs = new MemFs({ [join(home, '.claude', 'settings.json')]: '{}' });
    const r = await createClaudeCodeAdapter({
      fs,
      home,
      env: {},
      runVersion: async () => null,
    }).detect();
    expect(r).toMatchObject({ installed: true, roots: { claude: join(home, '.claude') } });
    expect(r.notes).toContain('CLI not found on PATH; using the config folder');
    const withCli = await createClaudeCodeAdapter({
      fs: new MemFs(),
      home,
      env: {},
      runVersion: async () => '3.1.0 (Claude Code)',
    }).detect();
    expect(withCli).toMatchObject({ installed: true, version: '3.1.0 (Claude Code)' });
  });

  it('scans a project target from <project>/.claude', async () => {
    const fs = new MemFs({
      [join('/', 'work', 'api', '.claude', 'agents', 'a.md')]:
        '---\nname: a\ndescription: d\n---\nx',
    });
    const groups = await createClaudeCodeAdapter({ fs, home, env: {} }).scan(project);
    expect(groups.map((g) => `${g.root}:${g.entry}`)).toEqual(['claude:agents/a.md']);
  });
});
