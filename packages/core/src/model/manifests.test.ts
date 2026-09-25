import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import { manifestJsonSchema } from './json-schema';
import { manifestSchemas, type ModeledKind } from './manifests';
import { parseManifest, type ManifestIssue } from './parse';

const issuesOf = (raw: unknown): ManifestIssue[] => {
  try {
    parseManifest(raw);
  } catch (e) {
    if (isAmcError(e, 'MANIFEST_INVALID')) return e.details as ManifestIssue[];
    throw e;
  }
  throw new Error('expected MANIFEST_INVALID');
};

const skill = {
  id: 'skill.security-checklist',
  kind: 'skill',
  name: 'Security Checklist',
  slug: 'security-checklist',
  description: 'Use when reviewing code for security issues.',
};

describe('manifest schemas', () => {
  it('accepts a minimal skill and applies defaults', () => {
    const m = parseManifest(skill);
    expect(m).toMatchObject({ version: '0.1.0', tags: [], triggers: [], dependsOn: [] });
  });

  it('accepts a full agent with equipped skills', () => {
    const m = parseManifest({
      id: 'agent.code-reviewer',
      kind: 'agent',
      name: 'Code Reviewer',
      slug: 'code-reviewer',
      version: '1.3.0',
      description: 'Reviews code for correctness and security.',
      model: { preferred: 'powerful', fallback: 'balanced' },
      tools: { allow: ['read', 'search', 'shell:readonly'], deny: ['write'] },
      skills: [{ ref: 'skill.security-checklist' }, { ref: 'skill.style-guide', mode: 'always' }],
      compat: { overrides: { 'claude-code': { raw: { color: 'purple' } } } },
    });
    expect(m.kind === 'agent' && m.skills[0]?.mode).toBe('on-demand');
  });

  it('accepts a command with arguments and an agent', () => {
    const m = parseManifest({
      id: 'command.review-pr',
      kind: 'command',
      name: 'Review PR',
      slug: 'review-pr',
      description: 'Review a pull request.',
      arguments: [{ name: 'pr', description: 'PR number' }],
      agent: 'agent.code-reviewer',
      preloadSkills: ['skill.git-basics'],
    });
    expect(m.kind === 'command' && m.arguments[0]?.required).toBe(false);
  });

  it.each([
    [{ ...skill, slug: 'Bad_Slug' }, 'slug'],
    [{ ...skill, slug: '-lead' }, 'slug'],
    [{ ...skill, slug: 'a'.repeat(65) }, 'slug'],
    [{ ...skill, id: 'agent.security-checklist' }, 'id'],
    [{ ...skill, id: 'nope' }, 'id'],
    [{ ...skill, version: '1.0' }, 'version'],
    [{ ...skill, description: '' }, 'description'],
    [{ ...skill, description: 'x'.repeat(1537) }, 'description'],
    [{ ...skill, dependsOn: ['agent.x'] }, 'dependsOn.0'],
  ])('rejects invalid skill field (%#) with path %s', (raw, path) => {
    expect(issuesOf(raw).map((i) => i.path)).toContain(path);
  });

  it('rejects agents equipping non-skills and wrong mode', () => {
    const base = { ...skill, id: 'agent.a', kind: 'agent', slug: 'a' };
    expect(issuesOf({ ...base, skills: [{ ref: 'agent.b' }] }).map((i) => i.path)).toContain(
      'skills.0.ref',
    );
    expect(
      issuesOf({ ...base, skills: [{ ref: 'skill.b', mode: 'sometimes' }] }).map((i) => i.path),
    ).toContain('skills.0.mode');
  });

  it('rejects duplicate command argument names', () => {
    const raw = {
      ...skill,
      id: 'command.c',
      kind: 'command',
      slug: 'c',
      arguments: [{ name: 'pr' }, { name: 'pr' }],
    };
    expect(issuesOf(raw).map((i) => i.path)).toContain('arguments.1.name');
  });

  it('rejects unknown kinds with a readable issue', () => {
    expect(issuesOf({ ...skill, kind: 'widget' })).toEqual([
      { path: 'kind', message: 'expected one of skill, agent, command' },
    ]);
  });
});

describe('generated JSON Schema', () => {
  it.each(Object.keys(manifestSchemas) as ModeledKind[])(
    '%s schema file is up to date (run `bun run --filter @amc/core schema`)',
    (kind) => {
      const file = join(__dirname, '..', '..', 'schema', `${kind}.amc.json`);
      const committed = JSON.parse(readFileSync(file, 'utf8'));
      expect(committed).toEqual(manifestJsonSchema(kind));
    },
  );
});
