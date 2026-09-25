import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import { resolveClosure } from '../resolver/closure';
import { buildGraph } from '../resolver/graph';
import { mk } from '../test-support';
import {
  alwaysSkills,
  inlineSkills,
  positionalIndex,
  renderTemplate,
  skillListBlock,
} from './degrade';
import { listRegions, readRegion, spliceRegion } from './regions';
import { AdapterRegistry } from './registry';
import { targetId, type ToolAdapter } from './types';

const AGENTS_MD = readFileSync(
  resolve(__dirname, '../../../../fixtures/codex-cli/codex-home/AGENTS.md'),
  'utf8',
);

/** Everything outside AMC's markers, which must never change (S7). */
const userText = (text: string) =>
  text.replace(/<!-- amc:begin (\S+) -->[\s\S]*?<!-- amc:end \1 -->\r?\n?/g, '');

describe('managed regions (T1.3.6, S7)', () => {
  it('reads the fixture’s region', () => {
    expect(listRegions(AGENTS_MD)).toEqual(['skill.style-guide']);
    expect(readRegion(AGENTS_MD, 'skill.style-guide')).toBe(
      '## Style guide (managed by AMC)\n\nPrefer named exports. Keep functions small.\n',
    );
    expect(readRegion(AGENTS_MD, 'nope')).toBeNull();
  });

  it('user text above, below, and between blocks survives apply → re-apply → remove', () => {
    let text = AGENTS_MD;
    text = spliceRegion(text, 'skill.style-guide', 'Updated style.\n');
    text = spliceRegion(text, 'agent.second', 'Second block.');
    // The user adds text between the two blocks.
    text = text.replace(
      '<!-- amc:begin agent.second -->',
      'User note between.\n\n<!-- amc:begin agent.second -->',
    );
    const withUser = userText(text);
    text = spliceRegion(text, 'skill.style-guide', 'Style v3.');
    text = spliceRegion(text, 'agent.second', 'Second v2.');
    expect(userText(text)).toBe(withUser);
    expect(readRegion(text, 'skill.style-guide')).toBe('Style v3.\n');
    expect(readRegion(text, 'agent.second')).toBe('Second v2.\n');
    // Re-applying the same content is byte-identical.
    expect(spliceRegion(text, 'agent.second', 'Second v2.')).toBe(text);

    text = spliceRegion(text, 'skill.style-guide', null);
    expect(listRegions(text)).toEqual(['agent.second']);
    expect(text).toContain(
      'These lines were written by the user and must never be changed by AMC.',
    );
    expect(text).toContain('More user text after the managed region.');
    expect(text).toContain('User note between.');
  });

  it('keeps CRLF files CRLF', () => {
    const crlf = 'Top\r\n';
    const out = spliceRegion(crlf, 'skill.x', 'a\nb');
    expect(out).toBe(
      'Top\r\n\r\n<!-- amc:begin skill.x -->\r\na\r\nb\r\n<!-- amc:end skill.x -->\r\n',
    );
    expect(readRegion(out, 'skill.x')).toBe('a\nb\n');
    expect(spliceRegion(out, 'skill.x', null)).toBe('Top\r\n\r\n');
  });

  it('creates a file from nothing and removes an absent region as a no-op', () => {
    expect(spliceRegion('', 'skill.x', 'hi')).toBe(
      '<!-- amc:begin skill.x -->\nhi\n<!-- amc:end skill.x -->\n',
    );
    expect(spliceRegion('keep', 'skill.x', null)).toBe('keep');
  });

  it('refuses broken markers rather than guessing', () => {
    for (const bad of [
      '<!-- amc:begin a -->\nx',
      '<!-- amc:end a -->',
      '<!-- amc:begin a -->\n<!-- amc:begin b -->\n<!-- amc:end b -->\n<!-- amc:end a -->',
      '<!-- amc:begin a -->\n<!-- amc:end a -->\n<!-- amc:begin a -->\n<!-- amc:end a -->',
    ]) {
      expect(() => spliceRegion(bad, 'z', 'x')).toThrow(
        expect.objectContaining({ code: 'REGION_MALFORMED' }),
      );
    }
    expect(() => spliceRegion('', 'bad id', 'x')).toThrow();
  });

  it('property: arbitrary user text outside markers is preserved', () => {
    const userLine = fc
      .string({ maxLength: 40 })
      .filter((s) => !s.includes('<!--') && !s.includes('\r') && !s.includes('\n'));
    fc.assert(
      fc.property(
        fc.array(userLine, { maxLength: 5 }),
        fc.array(userLine, { maxLength: 5 }),
        fc.string({ maxLength: 80 }).filter((s) => !s.includes('<!--')),
        (before, after, content) => {
          const base =
            [
              ...before,
              '<!-- amc:begin skill.a -->',
              'old',
              '<!-- amc:end skill.a -->',
              ...after,
            ].join('\n') + '\n';
          const out = spliceRegion(base, 'skill.a', content);
          expect(userText(out)).toBe(userText(base));
          expect(readRegion(out, 'skill.a')).toBe(
            content.replace(/\r\n/g, '\n').replace(/\n*$/, '\n'),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('degradation helpers (T1.3.1)', () => {
  const items = [
    mk('skill.base', {}, 'Base body'),
    mk('skill.a', { dependsOn: ['skill.base'], name: 'Skill A' }, 'A body'),
    mk('skill.b', {}, 'B body'),
    mk('agent.x', {
      skills: [
        { ref: 'skill.a', mode: 'always' },
        { ref: 'skill.b', mode: 'on-demand' },
        { ref: 'skill.base', mode: 'always' },
      ],
    }),
  ];
  const agent = resolveClosure(buildGraph(items), ['agent.x']).at(-1)!;

  it('collects always-on skills with dependencies first, once each', () => {
    expect(alwaysSkills(agent).map((s) => s.item.manifest.id)).toEqual(['skill.base', 'skill.a']);
  });

  it('inlines skill bodies under headings', () => {
    expect(inlineSkills('Prompt.\n', alwaysSkills(agent))).toBe(
      'Prompt.\n\n---\n\n## Skill: base\n\nBase body\n\n## Skill: Skill A\n\nA body\n',
    );
    expect(inlineSkills('Prompt.', [])).toBe('Prompt.');
  });

  it('lists skills with a tool-specific invocation', () => {
    expect(skillListBlock('Use:', alwaysSkills(agent), (s) => `/${s}`)).toBe(
      'Use:\n\n- /base: x\n- /a: x\n',
    );
  });

  it('renders templates with literal escaping outside placeholders only', () => {
    expect(
      renderTemplate(
        'a {{x}} $1 \\{{y}}',
        (n) => `$${n.toUpperCase()}`,
        (t) => t.replace(/\$/g, '$$$$'),
      ),
    ).toBe('a $X $$1 {{y}}');
    expect(positionalIndex('arg3')).toBe(3);
    expect(positionalIndex('arg0')).toBeUndefined();
    expect(positionalIndex('pr')).toBeUndefined();
  });
});

describe('targets and registry (T1.3.1, T1.3.7)', () => {
  it('builds stable target ids', () => {
    expect(targetId({ toolId: 'claude-code', scope: 'global' })).toBe('claude-code:global');
    expect(targetId({ toolId: 'codex-cli', scope: 'project', root: 'D:\\work\\api' })).toBe(
      'codex-cli:project:D:\\work\\api',
    );
  });

  it('registers adapters by id', () => {
    const fake = { id: 'fake', rules: [] } as unknown as ToolAdapter;
    const reg = new AdapterRegistry([fake]);
    expect(reg.get('fake')).toBe(fake);
    expect(reg.has('other')).toBe(false);
    expect(() => reg.register(fake)).toThrow(/Duplicate adapter/);
    let err: unknown;
    try {
      reg.get('other');
    } catch (e) {
      err = e;
    }
    expect(isAmcError(err, 'ADAPTER_NOT_FOUND')).toBe(true);
  });
});
