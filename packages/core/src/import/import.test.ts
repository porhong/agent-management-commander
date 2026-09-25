import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemFs } from '../fs/mem-fs';
import { LibraryService } from '../library/service';
import { mk } from '../test-support';
import { adoptCandidates } from './adopt';
import { groupCandidates, jaccard, normalizeBody, normalizeSlug, shingles } from './dedupe';
import { suggestLinks } from './suggest';
import type { Candidate, ScanResult } from './types';

const ROOT = join('/', 'h', '.amc', 'library');

const candidate = (
  targetId: string,
  id: string,
  body: string,
  fields: Record<string, unknown> = {},
  warnings: string[] = [],
): Candidate => {
  const [kind, slug] = id.split('.') as ['skill' | 'agent' | 'command', string];
  return {
    id: `${targetId}|root|${slug}`,
    targetId,
    toolId: targetId.split(':')[0]!,
    root: 'root',
    rootDir: join('/', targetId),
    entry: `${kind}s/${slug}`,
    files: [],
    linked: false,
    kind,
    item: mk(id, fields, body),
    warnings,
  };
};

const BODY = ['# Security checklist', '', '- Inputs validated', '- No secrets in code'].join('\n');

describe('normalizing (T1.8.2)', () => {
  it('treats the separators tools disagree about as the same slug', () => {
    expect(normalizeSlug('Security_Checklist')).toBe('security-checklist');
    expect(normalizeSlug('security checklist')).toBe('security-checklist');
    expect(normalizeSlug('--security--checklist--')).toBe('security-checklist');
  });

  it('ignores case, trailing space and blank lines when comparing bodies', () => {
    expect(normalizeBody('# Title  \n\n\nBody \n')).toBe(normalizeBody('# title\nbody'));
  });

  it('scores overlap between line shingles', () => {
    expect(jaccard(shingles(BODY), shingles(BODY))).toBe(1);
    expect(jaccard(shingles(BODY), shingles('# Something else\n\n- Nothing alike'))).toBe(0);
  });
});

describe('grouping candidates (T1.8.2)', () => {
  it('finds the same skill in two tools as one group', () => {
    const groups = groupCandidates([
      candidate('claude-code:global', 'skill.security-checklist', BODY),
      candidate('codex-cli:global', 'skill.security-checklist', BODY),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('skill.security-checklist');
    expect(groups[0]!.sources.map((s) => s.reason)).toEqual(['same-content', 'same-content']);
  });

  it('merges two differently named copies when the text is the same', () => {
    const groups = groupCandidates([
      candidate('claude-code:global', 'skill.security-checklist', BODY),
      candidate('codex-cli:global', 'skill.sec-list', BODY),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sources).toHaveLength(2);
  });

  it('merges text that drifted a little since it was copied to the other tool', () => {
    // A real skill is long enough that one edited line leaves the rest recognizable.
    const long = [
      '# Security checklist',
      '',
      ...Array.from({ length: 10 }, (_, i) => `- Check ${i}`),
    ].join('\n');
    expect(
      groupCandidates([
        candidate('a:global', 'skill.one', long),
        candidate('b:global', 'skill.two', `${long}\n- One extra line`),
      ]),
    ).toHaveLength(1);
  });

  it('keeps genuinely different items apart, and short ones that merely look alike', () => {
    expect(
      groupCandidates([
        candidate('a:global', 'skill.one', BODY),
        candidate('b:global', 'skill.two', '# Release notes\n\n- Tag the commit\n- Push it'),
      ]),
    ).toHaveLength(2);

    // Three lines with one of them different is a third of the item: too little to call it a copy.
    expect(
      groupCandidates([
        candidate('a:global', 'skill.one', BODY),
        candidate('b:global', 'skill.two', `${BODY}\n- One extra line`),
      ]),
    ).toHaveLength(2);
  });

  it('never merges across kinds, however alike the text', () => {
    expect(
      groupCandidates([
        candidate('a:global', 'skill.thing', BODY),
        candidate('b:global', 'agent.thing', BODY),
      ]),
    ).toHaveLength(2);
  });

  it('takes the richest source as canonical, and is not swayed by scan order', () => {
    const thin = candidate('a:global', 'skill.security-checklist', '# Short');
    const rich = candidate('b:global', 'skill.security-checklist', BODY, {
      tags: ['security'],
      triggers: ['reviewing a pull request'],
    });
    expect(groupCandidates([thin, rich])[0]!.canonicalId).toBe(rich.id);
    expect(groupCandidates([rich, thin])[0]!.canonicalId).toBe(rich.id);
  });

  it('flags a group that would collide with something already in the library', () => {
    const groups = groupCandidates(
      [candidate('a:global', 'skill.security-checklist', BODY)],
      new Set(['skill.security-checklist']),
    );
    expect(groups[0]!.existingId).toBe('skill.security-checklist');
  });
});

describe('link suggestions (T1.8.3)', () => {
  const build = () => {
    const candidates = [
      candidate(
        'a:global',
        'agent.code-reviewer',
        'Run the security-checklist skill before you comment.',
      ),
      candidate('a:global', 'skill.security-checklist', BODY),
      candidate('a:global', 'command.review-pr', 'Hand this to @code-reviewer.'),
      candidate('a:global', 'skill.api', 'Nothing to do with anything.'),
    ];
    return { candidates, groups: suggestLinks(groupCandidates(candidates), candidates) };
  };

  it('suggests the link a body implies, with the line it came from', () => {
    const { groups } = build();
    const agent = groups.find((g) => g.key === 'agent.code-reviewer')!;
    expect(agent.suggestions).toEqual([
      {
        to: 'skill.security-checklist',
        relation: 'equips',
        evidence: 'Run the security-checklist skill before you comment.',
      },
    ]);
  });

  it('reads an @mention as the command running that agent', () => {
    const { groups } = build();
    const command = groups.find((g) => g.key === 'command.review-pr')!;
    expect(command.suggestions).toEqual([
      {
        to: 'agent.code-reviewer',
        relation: 'uses-agent',
        evidence: 'Hand this to @code-reviewer.',
      },
    ]);
  });

  it('leaves short slugs alone, because prose is full of them', () => {
    const { groups } = build();
    expect(groups.flatMap((g) => g.suggestions).some((s) => s.to === 'skill.api')).toBe(false);
  });

  it('suggests nothing for a relation the model does not allow', () => {
    const candidates = [
      candidate('a:global', 'skill.security-checklist', 'See the review-pr command.'),
      candidate('a:global', 'command.review-pr', 'x'),
    ];
    const groups = suggestLinks(groupCandidates(candidates), candidates);
    expect(groups.flatMap((g) => g.suggestions)).toEqual([]);
  });
});

describe('adopting (T1.8.4)', () => {
  const scanOf = (candidates: Candidate[]): ScanResult => ({
    candidates,
    groups: suggestLinks(groupCandidates(candidates), candidates),
    fileCount: candidates.length,
    warnings: [],
  });

  const library = () => new LibraryService({ fs: new MemFs(), root: ROOT });

  it('writes the chosen source into the library and reports where it came from', async () => {
    const lib = library();
    const scan = scanOf([
      candidate('claude-code:global', 'skill.security-checklist', BODY),
      candidate('codex-cli:global', 'skill.security-checklist', BODY),
    ]);
    const result = await adoptCandidates(lib, scan, [
      { key: 'skill.security-checklist', slug: 'security-checklist' },
    ]);

    expect(result.created).toEqual(['skill.security-checklist']);
    expect(result.targetIds).toEqual(['claude-code:global', 'codex-cli:global']);
    expect((await lib.get('skill.security-checklist')).body).toBe(BODY);
  });

  it('honours a slug the user changed to settle a clash', async () => {
    const lib = library();
    await lib.create({ kind: 'skill', slug: 'security-checklist', description: 'Already here.' });
    const scan = scanOf([candidate('a:global', 'skill.security-checklist', BODY)]);

    const clash = await adoptCandidates(lib, scan, [
      { key: 'skill.security-checklist', slug: 'security-checklist' },
    ]);
    expect(clash.created).toEqual([]);
    expect(clash.skipped[0]!.reason).toMatch(/security-checklist/);

    const renamed = await adoptCandidates(lib, scan, [
      { key: 'skill.security-checklist', slug: 'security-checklist-imported' },
    ]);
    expect(renamed.created).toEqual(['skill.security-checklist-imported']);
  });

  it('applies only the links that were accepted', async () => {
    const lib = library();
    const scan = scanOf([
      candidate('a:global', 'agent.code-reviewer', 'Use security-checklist and style-guide.'),
      candidate('a:global', 'skill.security-checklist', BODY),
      candidate('a:global', 'skill.style-guide', '# Style\n\n- Named exports'),
    ]);
    // Both were suggested; only one is accepted.
    expect(
      scan.groups.find((g) => g.key === 'agent.code-reviewer')!.suggestions.map((s) => s.to),
    ).toEqual(['skill.security-checklist', 'skill.style-guide']);

    await adoptCandidates(lib, scan, [
      { key: 'skill.security-checklist', slug: 'security-checklist' },
      { key: 'skill.style-guide', slug: 'style-guide' },
      {
        key: 'agent.code-reviewer',
        slug: 'code-reviewer',
        links: [{ to: 'skill.security-checklist', relation: 'equips' }],
      },
    ]);

    const agent = await lib.get('agent.code-reviewer');
    expect(agent.manifest).toMatchObject({
      skills: [{ ref: 'skill.security-checklist', mode: 'on-demand' }],
    });
  });

  it('keeps going when one item cannot be written', async () => {
    const lib = library();
    const scan = scanOf([
      candidate('a:global', 'skill.security-checklist', BODY),
      candidate('a:global', 'skill.style-guide', '# Style\n\n- Named exports'),
    ]);
    const result = await adoptCandidates(lib, scan, [
      { key: 'skill.security-checklist', slug: 'NOT a slug' },
      { key: 'skill.style-guide', slug: 'style-guide' },
    ]);
    expect(result.created).toEqual(['skill.style-guide']);
    expect(result.skipped).toHaveLength(1);
  });
});
