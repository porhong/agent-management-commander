import { describe, expect, it } from 'vitest';
import { estimateTokens, fromYaml, isDirty, issuesFor, toYaml, type Draft } from './draft';

const draft = (manifest: Record<string, unknown>, body = 'b'): Draft => ({ manifest, body });

const BASE = {
  id: 'agent.code-reviewer',
  kind: 'agent',
  name: 'Code Reviewer',
  slug: 'code-reviewer',
  version: '1.0.0',
  description: 'Reviews changes.',
  skills: [{ ref: 'skill.style-guide', mode: 'on-demand' }],
};

describe('unsaved-change detection', () => {
  it('ignores the version and stamps, which the library maintains', () => {
    const saved = draft({ ...BASE, updatedAt: '2026-01-01T00:00:00Z' });
    const same = draft({ ...BASE, version: '9.9.9', updatedAt: '2026-09-25T00:00:00Z' });
    expect(isDirty(same, saved)).toBe(false);
  });

  it('ignores key order at every depth', () => {
    const saved = draft({ ...BASE });
    const reordered = draft({
      skills: [{ mode: 'on-demand', ref: 'skill.style-guide' }],
      description: 'Reviews changes.',
      version: '1.0.0',
      slug: 'code-reviewer',
      name: 'Code Reviewer',
      kind: 'agent',
      id: 'agent.code-reviewer',
    });
    expect(isDirty(reordered, saved)).toBe(false);
  });

  it('sees a change inside a nested reference', () => {
    const saved = draft({ ...BASE });
    const equipped = draft({ ...BASE, skills: [{ ref: 'skill.style-guide', mode: 'always' }] });
    expect(isDirty(equipped, saved)).toBe(true);
  });

  it('sees a change to the body', () => {
    expect(isDirty(draft(BASE, 'new'), draft(BASE, 'old'))).toBe(true);
  });
});

describe('raw mode', () => {
  it('writes the manifest in the library’s key order', () => {
    const yaml = toYaml({ description: 'd', id: 'skill.x', kind: 'skill', name: 'X' }, 'skill');
    expect(yaml.split('\n').slice(0, 4)).toEqual([
      'id: skill.x',
      'kind: skill',
      'name: X',
      'description: d',
    ]);
  });

  it('keeps fields it does not know about, rather than dropping them', () => {
    expect(toYaml({ id: 'skill.x', somethingNew: true }, 'skill')).toContain('somethingNew: true');
  });

  it('explains what is wrong instead of throwing', () => {
    const result = fromYaml('name: [unclosed');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/isn't valid YAML/);
  });

  it('refuses a document that is not a set of fields', () => {
    expect(fromYaml('- a\n- b')).toEqual({
      ok: false,
      message: 'The manifest must be a set of keys and values.',
    });
  });

  it('round-trips a manifest', () => {
    const parsed = fromYaml(toYaml(BASE, 'agent'));
    expect(parsed.ok && parsed.manifest).toEqual(BASE);
  });
});

describe('issue routing', () => {
  const issue = (path?: string) =>
    ({
      ruleId: 'r',
      severity: 'error',
      message: 'm',
      blocking: false,
      ...(path && { path }),
    }) as never;

  it('matches a field and anything inside it', () => {
    const issues = [issue('skills'), issue('skills.0.ref'), issue('name'), issue()];
    expect(issuesFor(issues, 'skills')).toHaveLength(2);
    expect(issuesFor(issues, 'name')).toHaveLength(1);
  });
});

describe('token estimate', () => {
  it('is about four characters a token', () => {
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});
