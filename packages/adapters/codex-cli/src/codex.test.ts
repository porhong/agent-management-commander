import { join, resolve } from 'node:path';
import {
  buildGraph,
  itemDir,
  MemFs,
  NodeFs,
  parseFrontmatter,
  parseManifest,
  readItem,
  resolveClosure,
  serializeManifest,
  toLf,
  Validator,
  writeItem,
  type LibraryItem,
  type NativeGroup,
  type Target,
} from '@amc/core';
import { describe, expect, it } from 'vitest';
import {
  compileItem,
  createCodexAdapter,
  parseGroup,
  parseToml,
  scanRoots,
  stringifyAgentToml,
  toCanonicalTemplate,
  toPromptTemplate,
  toSandbox,
} from './index';

const FIX = resolve(__dirname, '../../../../fixtures/codex-cli');
const GLOBAL_ROOTS = { codex: join(FIX, 'codex-home'), agents: join(FIX, 'agents-home') };
const GLOBAL: Target = { toolId: 'codex-cli', scope: 'global' };
const PROJECT: Target = { toolId: 'codex-cli', scope: 'project', root: join(FIX, 'project') };
const MODELS = { powerful: 'gpt-5.5' };

const scanGlobal = () => scanRoots(new NodeFs(), GLOBAL_ROOTS, { prompts: true });
const scanProject = () =>
  createCodexAdapter({ fs: new NodeFs(), home: '/nowhere', env: {} }).scan(PROJECT);

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

function compileOne(items: LibraryItem[], id: string, target: Target = GLOBAL) {
  const resolved = resolveClosure(buildGraph(items), [id]).at(-1)!;
  return compileItem(resolved, target, MODELS);
}

/** Semantic form of a native file: parsed TOML, or frontmatter data + LF body. */
function semantic(relPath: string, content: string) {
  if (relPath.endsWith('.toml')) return parseToml(content, relPath);
  const fm = parseFrontmatter(content);
  return { data: fm.data, body: toLf(fm.body).trim() };
}

async function expectRoundTrip(group: NativeGroup, target: Target) {
  const { item } = parseGroup(group, MODELS);
  const lib = new MemFs();
  const dir = itemDir(join('/', 'lib'), item.manifest);
  await writeItem(lib, dir, item);
  const compiled = compileOne([await readItem(lib, dir)], item.manifest.id, target);
  expect(compiled.map((f) => `${f.root}:${f.relPath}`).sort()).toEqual(
    group.files.map((f) => `${group.root}:${f.relPath}`).sort(),
  );
  for (const native of group.files) {
    const out = compiled.find((f) => f.relPath === native.relPath)!;
    if (native.relPath === group.entry) {
      expect(semantic(out.relPath, out.content.toString()), native.relPath).toEqual(
        semantic(native.relPath, native.content.toString('utf8')),
      );
    } else {
      expect(Buffer.from(out.content).equals(native.content), native.relPath).toBe(true);
    }
  }
}

describe('Codex adapter: scan & parse (T1.3.5)', () => {
  it('scans agents, prompts, and skills across both roots', async () => {
    expect((await scanGlobal()).map((g) => `${g.kind}:${g.root}:${g.entry}`).sort()).toEqual([
      'agent:codex:agents/code-reviewer.toml',
      'command:codex:prompts/review-pr.md',
      'skill:agents:skills/security-checklist/SKILL.md',
    ]);
    // Projects have no prompts.
    expect((await scanProject()).map((g) => `${g.kind}:${g.root}:${g.entry}`).sort()).toEqual([
      'agent:codex:agents/implementer.toml',
      'skill:agents:skills/repo-conventions/SKILL.md',
    ]);
  });

  it('round-trips every fixture: parse → library → compile ≈ original', async () => {
    for (const g of await scanGlobal()) await expectRoundTrip(g, GLOBAL);
    for (const g of await scanProject()) await expectRoundTrip(g, PROJECT);
  });

  it('produces reviewed canonical manifests (golden)', async () => {
    const groups = [...(await scanGlobal()), ...(await scanProject())];
    const golden = groups
      .sort((a, b) => a.entry.localeCompare(b.entry))
      .map((g) => {
        const { item, warnings } = parseGroup(g, MODELS);
        return `# ${g.root}:${g.entry}${warnings.length ? `\n# warnings: ${warnings.join('; ')}` : ''}\n${serializeManifest(item.manifest)}--- body ---\n${item.body}`;
      })
      .join('\n==========\n');
    expect(golden).toMatchSnapshot();
  });

  it('maps prompt placeholders, including named args and $$', async () => {
    const prompt = (await scanGlobal()).find((g) => g.kind === 'command')!;
    const { item } = parseGroup(prompt);
    expect(item.body).toContain('Review pull request {{pr}} with focus on {{focus}}.');
    expect(item.body).toContain('All arguments: {{args}}. Cost is $5 per review');
    expect(item.manifest.kind === 'command' && item.manifest.arguments.map((a) => a.name)).toEqual([
      'pr',
      'focus',
    ]);
  });
});

describe('Codex adapter: compile & degradations (T1.3.5)', () => {
  it('inlines always-on skills (with dependencies) and maps model and sandbox', () => {
    const items = [
      mk('skill.base', {}, 'Base rules.'),
      mk('skill.sec', { dependsOn: ['skill.base'] }, 'Check for injection.'),
      mk('skill.style', {}, 'Style.'),
      mk(
        'agent.rev',
        {
          model: { preferred: 'powerful' },
          tools: { allow: ['read', 'search'], deny: ['shell'] },
          skills: [
            { ref: 'skill.sec', mode: 'always' },
            { ref: 'skill.style', mode: 'on-demand' },
          ],
        },
        'You review code.\n',
      ),
    ];
    const [file] = compileOne(items, 'agent.rev');
    expect(file!.root).toBe('codex');
    expect(file!.relPath).toBe('agents/rev.toml');
    const toml = parseToml(file!.content.toString(), 'x');
    expect(toml).toMatchObject({ name: 'rev', model: 'gpt-5.5', sandbox_mode: 'read-only' });
    const instructions = toml['developer_instructions'] as string;
    expect(instructions).toContain('You review code.');
    expect(instructions.indexOf('Base rules.')).toBeLessThan(
      instructions.indexOf('Check for injection.'),
    );
    expect(instructions).not.toContain('Style.');
    expect(file!.adaptations.map((a) => a.code)).toEqual([
      'agent.skills.inlined',
      'agent.tools.sandbox',
      'agent.tools.deny.dropped',
    ]);
  });

  it('never grants more than workspace-write', () => {
    expect(toSandbox([])).toBe('read-only');
    expect(toSandbox(['read', 'search', 'shell:readonly', 'mcp:github'])).toBe('read-only');
    expect(toSandbox(['edit'])).toBe('workspace-write');
    expect(toSandbox(['shell'])).toBe('workspace-write');
    expect(toSandbox(['shell:git'])).toBe('workspace-write');
  });

  it('reports an unmapped model tier instead of guessing', () => {
    const [file] = compileOne([mk('agent.a', { model: { preferred: 'fast' } })], 'agent.a');
    expect(parseToml(file!.content.toString(), 'x')['model']).toBeUndefined();
    expect(file!.adaptations.map((a) => a.code)).toEqual(['agent.model.unmapped']);
  });

  it('compiles a global command to a deprecated prompt with escaped dollars', () => {
    const items = [
      mk('skill.sec'),
      mk('agent.rev'),
      mk(
        'command.review',
        { arguments: [{ name: 'pr' }], agent: 'agent.rev', preloadSkills: ['skill.sec'] },
        'Review {{pr}} ({{args}}), first {{arg1}}. Budget $5, see $HOME, keep \\{{x}}.',
      ),
    ];
    const [file] = compileOne(items, 'command.review');
    expect(`${file!.root}:${file!.relPath}`).toBe('codex:prompts/review.md');
    const { body } = parseFrontmatter(file!.content.toString());
    expect(body).toContain('Delegate this task to the `rev` agent.');
    expect(body).toContain('- $sec: About sec.');
    expect(body).toContain(
      'Review $PR ($ARGUMENTS), first $1. Budget $$5, see $$HOME, keep {{x}}.',
    );
    expect(file!.adaptations.map((a) => a.code)).toEqual([
      'command.agent.prompt',
      'command.preload.prompt',
      'command.prompt.deprecated',
    ]);
  });

  it('compiles a project command to a repo skill', () => {
    const items = [
      mk(
        'command.ship',
        { arguments: [{ name: 'env', description: 'Where to' }] },
        'Ship to {{env}}: {{args}}',
      ),
    ];
    const [file] = compileOne(items, 'command.ship', PROJECT);
    expect(`${file!.root}:${file!.relPath}`).toBe('agents:skills/ship/SKILL.md');
    const fm = parseFrontmatter(file!.content.toString());
    expect(fm.data).toEqual({ name: 'ship', description: 'About ship.' });
    expect(fm.body).toContain('- <env>: Where to');
    expect(fm.body).toContain("Ship to <env>: the user's request");
    expect(file!.adaptations.map((a) => a.code)).toEqual(['command.as-skill']);
  });

  it('drops per-skill tools and triggers with adaptations', () => {
    const [file] = compileOne(
      [mk('skill.s', { allowedTools: ['read'], triggers: ['review'] }, 'Body')],
      'skill.s',
    );
    expect(`${file!.root}:${file!.relPath}`).toBe('agents:skills/s/SKILL.md');
    expect(file!.adaptations.map((a) => a.code)).toEqual([
      'skill.tools.dropped',
      'skill.triggers.dropped',
    ]);
  });
});

describe('Codex templates and TOML', () => {
  it('prompt templates survive native → canonical → native', () => {
    const native = 'Do $1 then $2 for $PR_ID. $ARGUMENTS. Price $$9. Literal {{curly}}.';
    const canonical = toCanonicalTemplate(native);
    expect(canonical.body).toBe(
      'Do {{arg1}} then {{arg2}} for {{pr_id}}. {{args}}. Price $9. Literal \\{{curly}}.',
    );
    expect(toPromptTemplate(canonical.body).body).toBe(native);
  });

  it('maps positions above 9 to $ARGUMENTS and says so', () => {
    expect(toPromptTemplate('{{arg10}}')).toEqual({ body: '$ARGUMENTS', unmapped: ['arg10'] });
  });

  it('writes developer_instructions as a readable literal, tables last', () => {
    const toml = stringifyAgentToml(
      { name: 'a', mcp_servers: { gh: { command: 'gh-mcp' } }, model: 'm' },
      'Line "one"\nC:\\path\n',
    );
    expect(toml).toBe(
      [
        'name = "a"',
        'model = "m"',
        "developer_instructions = '''",
        'Line "one"',
        'C:\\path',
        "'''",
        '',
        '[mcp_servers.gh]',
        'command = "gh-mcp"',
        '',
      ].join('\n'),
    );
    expect(parseToml(toml, 'x')['developer_instructions']).toBe('Line "one"\nC:\\path\n');
    // Content that can't be a literal string falls back to an escaped one.
    const tricky = stringifyAgentToml({ name: 'a' }, "has ''' inside");
    expect(parseToml(tricky, 'x')['developer_instructions']).toBe("has ''' inside");
    const control = stringifyAgentToml({ name: 'a' }, 'bell \u0007 and\ttab');
    expect(parseToml(control, 'x')['developer_instructions']).toBe('bell \u0007 and\ttab');
  });
});

describe('Codex adapter: targets, detection, rules (T1.3.2, T1.3.7)', () => {
  it('uses CODEX_HOME and ~/.agents globally, and stays under the project root', () => {
    const home = join('/', 'home', 'u');
    const a = createCodexAdapter({ fs: new MemFs(), home, env: { CODEX_HOME: join('/', 'ch') } });
    expect(a.paths(GLOBAL)).toEqual({ codex: join('/', 'ch'), agents: join(home, '.agents') });
    const root = join('/', 'work', 'api');
    expect(a.paths({ toolId: 'codex-cli', scope: 'project', root })).toEqual({
      codex: join(root, '.codex'),
      agents: join(root, '.agents'),
    });
  });

  it('detects from the folder when the CLI is missing, and from the CLI alone', async () => {
    const home = join('/', 'home', 'u');
    const fs = new MemFs({ [join(home, '.codex', 'config.toml')]: 'x' });
    const noCli = await createCodexAdapter({
      fs,
      home,
      env: {},
      runVersion: async () => null,
    }).detect();
    expect(noCli).toMatchObject({ installed: true });
    expect(noCli.version).toBeUndefined();
    const cliOnly = await createCodexAdapter({
      fs: new MemFs(),
      home,
      env: {},
      runVersion: async (cmd) => (cmd === 'codex' ? 'codex-cli 0.140.0' : null),
    }).detect();
    expect(cliOnly).toMatchObject({ installed: true, version: 'codex-cli 0.140.0' });
    const none = await createCodexAdapter({ fs: new MemFs(), home, env: {} }).detect();
    expect(none.installed).toBe(false);
  });

  it('registers per-target rules: skill description limit and project command collisions', () => {
    const adapter = createCodexAdapter({ fs: new MemFs(), home: '/', env: {} });
    const v = new Validator(adapter.rules);
    const items = [
      mk('skill.deploy', { description: 'x'.repeat(1100) }),
      mk('command.deploy'),
      mk('command.other', { description: 'y'.repeat(1100) }),
    ];
    const global = v.validate({
      items,
      targets: [{ id: 'codex-cli:global', toolId: 'codex-cli' }],
    });
    expect(global.map((i) => [i.ruleId, i.itemId])).toEqual([
      ['description-limit:codex-cli:skill', 'skill.deploy'],
    ]);
    const project = v.validate({
      items,
      targets: [{ id: 'codex-cli:project:/p', toolId: 'codex-cli' }],
    });
    expect(project.map((i) => [i.ruleId, i.itemId, i.path])).toEqual([
      ['codex-cli:project-command-as-skill', 'command.deploy', 'slug'],
      ['codex-cli:project-command-as-skill', 'command.other', 'description'],
      ['description-limit:codex-cli:skill', 'skill.deploy', 'description'],
    ]);
  });
});
