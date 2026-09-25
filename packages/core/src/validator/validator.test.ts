import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../library/item-io';
import { mk } from '../test-support';
import {
  CORE_RULES,
  INLINE_PROMPT_LIMIT,
  descriptionLimitRule,
  descriptionMinRule,
  inlinePromptSizeRule,
  manifestSchemaRule,
  noCyclesRule,
  refResolvesRule,
  secretScanRule,
  slugNamingRule,
  slugPathSafeRule,
  slugUniqueRule,
  templatePlaceholdersRule,
  unusedItemRule,
  untrustedScriptsRule,
} from './rules';
import { SECRET_PATTERNS, scanForSecrets } from './secrets';
import type { Rule } from './types';
import { Validator, hasBlockingIssues, type ValidateInput } from './validator';

const DESC = 'A description long enough for tools.';
const ok = (id: string, fields: Record<string, unknown> = {}, body = '', files = {}) =>
  mk(id, { description: DESC, ...fields }, body, files);

const run = (rule: Rule, input: ValidateInput) => new Validator([rule]).validate(input);
const only = (items: LibraryItem[]) => ({ items });

// Built from pieces so the repo itself never contains a key-shaped string.
const FAKE_AWS = 'AKIA' + 'Q'.repeat(16);
const FAKE_GH = 'ghp' + '_' + 'a1B2'.repeat(9);
const FAKE_ANT = 'sk-' + 'ant-' + 'api03-' + 'x'.repeat(30);

describe('rules: passing and failing fixtures (T1.2.5)', () => {
  it('manifest-schema reports load problems', () => {
    expect(run(manifestSchemaRule, { items: [] })).toEqual([]);
    const issues = run(manifestSchemaRule, {
      items: [],
      problems: [{ path: 'skills/broken', message: 'id: expected <kind>.<slug>' }],
    });
    expect(issues).toMatchObject([
      {
        ruleId: 'manifest-schema',
        severity: 'error',
        blocking: true,
        file: 'skills/broken/amc.yaml',
      },
    ]);
  });

  it('ref-resolves flags broken refs with a fix that removes just that entry', () => {
    expect(
      run(refResolvesRule, only([ok('skill.a'), ok('agent.x', { skills: [{ ref: 'skill.a' }] })])),
    ).toEqual([]);
    const issues = run(
      refResolvesRule,
      only([
        ok('skill.a'),
        ok('agent.x', { skills: [{ ref: 'skill.a' }, { ref: 'skill.gone', mode: 'always' }] }),
        ok('command.c', { agent: 'agent.gone' }),
      ]),
    );
    expect(issues).toMatchObject([
      {
        itemId: 'agent.x',
        path: 'skills.1.ref',
        fix: { itemId: 'agent.x', fields: { skills: [{ ref: 'skill.a', mode: 'on-demand' }] } },
      },
      { itemId: 'command.c', path: 'agent', fix: { fields: { agent: undefined } } },
    ]);
  });

  it('no-cycles reports the full path', () => {
    expect(
      run(noCyclesRule, only([ok('skill.a', { dependsOn: ['skill.b'] }), ok('skill.b')])),
    ).toEqual([]);
    const issues = run(
      noCyclesRule,
      only([ok('skill.a', { dependsOn: ['skill.b'] }), ok('skill.b', { dependsOn: ['skill.a'] })]),
    );
    expect(issues).toMatchObject([
      { itemId: 'skill.a', message: 'Reference cycle: skill.a → skill.b → skill.a' },
    ]);
  });

  it('slug-unique flags two items of one kind with the same slug', () => {
    expect(run(slugUniqueRule, only([ok('skill.a'), ok('agent.a')]))).toEqual([]);
    const renamed = ok('skill.b', { slug: 'a' });
    const issues = run(slugUniqueRule, only([ok('skill.a'), renamed]));
    expect(issues.map((i) => i.itemId)).toEqual(['skill.a', 'skill.b']);
    expect(issues[0]!.message).toContain('skill.b');
  });

  it('slug-path-safe rejects Windows device names', () => {
    expect(run(slugPathSafeRule, only([ok('skill.console'), ok('skill.com10')]))).toEqual([]);
    const issues = run(
      slugPathSafeRule,
      only([ok('skill.con'), ok('agent.lpt1'), ok('command.nul')]),
    );
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.path === 'slug' && i.blocking)).toBe(true);
  });

  it('description-min warns below 20 characters', () => {
    expect(run(descriptionMinRule, only([ok('skill.a')]))).toEqual([]);
    expect(
      run(descriptionMinRule, only([mk('skill.a', { description: 'Too short' })])),
    ).toMatchObject([{ severity: 'warning', blocking: false, path: 'description' }]);
  });

  it('inline-prompt-size counts the body plus always-on skills and their dependencies', () => {
    const third = 'x'.repeat(INLINE_PROMPT_LIMIT / 3 + 1);
    const items = (mode: string) => [
      ok('skill.base', {}, third),
      ok('skill.big', { dependsOn: ['skill.base'] }, third),
      ok('agent.a', { skills: [{ ref: 'skill.big', mode }] }, third),
    ];
    expect(run(inlinePromptSizeRule, only(items('on-demand')))).toEqual([]);
    expect(run(inlinePromptSizeRule, only(items('always')))).toMatchObject([
      { itemId: 'agent.a', severity: 'warning' },
    ]);
  });

  it('untrusted-scripts blocks deploy only when scripts exist and are untrusted', () => {
    const script = { 'scripts/run.ps1': Buffer.from('echo hi') };
    expect(
      run(
        untrustedScriptsRule,
        only([
          ok('skill.a', { scripts: { trust: 'reviewed' } }, '', script),
          ok('skill.b', { scripts: { trust: 'untrusted' } }),
        ]),
      ),
    ).toEqual([]);
    const issues = run(
      untrustedScriptsRule,
      only([ok('skill.a', { scripts: { trust: 'untrusted' } }, '', script)]),
    );
    expect(issues).toMatchObject([{ severity: 'warning', blocking: true }]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('unused-item reports items neither deployed nor referenced, only with deploy data', () => {
    const items = [ok('skill.a'), ok('skill.b'), ok('agent.x', { skills: [{ ref: 'skill.a' }] })];
    expect(run(unusedItemRule, { items })).toEqual([]);
    expect(run(unusedItemRule, { items, deployed: new Set(['agent.x', 'skill.b']) })).toEqual([]);
    expect(run(unusedItemRule, { items, deployed: new Set(['agent.x']) })).toMatchObject([
      { itemId: 'skill.b', severity: 'info', blocking: false },
    ]);
  });

  it('secret-scan finds keys in body, manifest, and text files, never echoing them', () => {
    expect(
      run(secretScanRule, only([ok('skill.a', {}, 'Set ANTHROPIC_API_KEY in your env.')])),
    ).toEqual([]);
    const issues = run(
      secretScanRule,
      only([
        ok('skill.a', { tags: [FAKE_GH.slice(0, 40)] }, `line 1\nkey = ${FAKE_AWS}\n`, {
          'references/notes.md': Buffer.from(`token: ${FAKE_ANT}`),
          'scripts/bin.dat': Buffer.from([0, 1, 2, ...Buffer.from(FAKE_AWS)]),
        }),
      ]),
    );
    expect(issues.map((i) => [i.file, i.line])).toEqual([
      ['skills/a/amc.yaml', 8],
      ['skills/a/SKILL.md', 2],
      ['skills/a/references/notes.md', 1],
    ]);
    for (const i of issues) {
      expect(i.message).not.toContain(FAKE_AWS);
      expect(i.message).not.toContain(FAKE_ANT);
    }
  });

  it('template-placeholders flags undeclared names, with a fix that declares them', () => {
    const good = ok(
      'command.c',
      { arguments: [{ name: 'pr' }] },
      '{{pr}} {{args}} {{arg2}} \\{{x}}',
    );
    expect(run(templatePlaceholdersRule, only([good]))).toEqual([]);
    const bad = ok('command.c', { arguments: [{ name: 'pr' }] }, '{{pr}} {{ticket}} {{arg0}}');
    expect(run(templatePlaceholdersRule, only([bad]))).toMatchObject([
      {
        severity: 'warning',
        message: 'Template uses undeclared arguments: ticket, arg0',
        fix: { fields: { arguments: [{ name: 'pr' }, { name: 'ticket' }, { name: 'arg0' }] } },
      },
    ]);
  });

  it('descriptionLimitRule applies once per matching target', () => {
    const rule = descriptionLimitRule('codex-cli', 30, 'error');
    const items = [ok('skill.a')];
    expect(
      run(rule, { items, targets: [{ id: 'claude-code:global', toolId: 'claude-code' }] }),
    ).toEqual([]);
    const issues = run(rule, {
      items,
      targets: [
        { id: 'codex-cli:global', toolId: 'codex-cli' },
        { id: 'codex-cli:project:api', toolId: 'codex-cli' },
      ],
    });
    expect(issues.map((i) => [i.ruleId, i.targetId, i.severity])).toEqual([
      ['description-limit:codex-cli', 'codex-cli:global', 'error'],
      ['description-limit:codex-cli', 'codex-cli:project:api', 'error'],
    ]);
  });

  it('slugNamingRule lets an adapter plug in its naming check', () => {
    const rule = slugNamingRule('tool', (slug) => (slug.length > 5 ? 'max 5 chars' : null));
    const targets = [{ id: 'tool:global', toolId: 'tool' }];
    expect(run(rule, { items: [ok('skill.short')], targets })).toEqual([]);
    expect(run(rule, { items: [ok('skill.too-long')], targets })).toMatchObject([
      { targetId: 'tool:global', message: 'max 5 chars', blocking: true },
    ]);
  });
});

describe('Validator (T1.2.4)', () => {
  it('runs all core rules, sorted by severity then item', () => {
    const v = new Validator(CORE_RULES);
    const issues = v.validate({
      items: [
        mk('skill.z', { description: 'short' }),
        ok('agent.a', { skills: [{ ref: 'skill.gone' }] }),
      ],
    });
    expect(issues.map((i) => [i.severity, i.ruleId, i.itemId])).toEqual([
      ['error', 'ref-resolves', 'agent.a'],
      ['warning', 'description-min', 'skill.z'],
    ]);
  });

  it('accepts adapter rules and rejects duplicate ids', () => {
    const v = new Validator(CORE_RULES).register(descriptionLimitRule('codex-cli', 10, 'warning'));
    expect(v.ruleIds).toContain('description-limit:codex-cli');
    expect(() => v.register(descriptionMinRule)).toThrow(/Duplicate rule/);
  });

  it('can restrict issues to a selection', () => {
    const items = [
      mk('skill.a', { description: 'short' }),
      mk('skill.b', { description: 'short' }),
    ];
    const issues = new Validator(CORE_RULES).validate({ items, only: new Set(['skill.b']) });
    expect(issues.map((i) => i.itemId)).toEqual(['skill.b']);
  });
});

describe('secret patterns', () => {
  it('each pattern has a matching sample and ignores plain prose', () => {
    const samples: Record<string, string> = {
      'private-key': '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----',
      'aws-access-key': FAKE_AWS,
      'github-token': FAKE_GH,
      'anthropic-key': FAKE_ANT,
      'openai-key': 'sk-' + 'proj-' + 'A'.repeat(48),
      'google-api-key': 'AIza' + 'B'.repeat(35),
      'slack-token': 'xox' + 'b-' + '1234567890-abc',
      'stripe-key': 'sk_' + 'live_' + 'C'.repeat(24),
    };
    expect(Object.keys(samples).sort()).toEqual(SECRET_PATTERNS.map((p) => p.id).sort());
    for (const [id, sample] of Object.entries(samples)) {
      expect(scanForSecrets(`x ${sample} y`).map((h) => h.patternId)).toEqual([id]);
    }
    expect(scanForSecrets('Use sk-style keys; ask for the AKIA prefix; see ghp_ docs.')).toEqual(
      [],
    );
  });
});
