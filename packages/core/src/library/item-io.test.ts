import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import { MemFs } from '../fs/mem-fs';
import { parseManifest } from '../model/parse';
import type { Manifest } from '../model/manifests';
import { itemDir, readItem, serializeManifest, writeItem, type LibraryItem } from './item-io';

const LIB = join('/', 'amc', 'library');

const agent: LibraryItem = {
  manifest: parseManifest({
    id: 'agent.code-reviewer',
    kind: 'agent',
    name: 'Code Reviewer',
    slug: 'code-reviewer',
    version: '1.3.0',
    description: 'Reviews code.\nFocus on security.',
    skills: [{ ref: 'skill.security-checklist', mode: 'always' }],
  }),
  body: 'You are a senior reviewer.\n',
  files: {},
};

describe('item IO', () => {
  it('writes a stable, minimal, ordered amc.yaml', () => {
    expect(serializeManifest(agent.manifest)).toBe(
      [
        'id: agent.code-reviewer',
        'kind: agent',
        'name: Code Reviewer',
        'slug: code-reviewer',
        'version: 1.3.0',
        'description: |-',
        '  Reviews code.',
        '  Focus on security.',
        'skills:',
        '  - ref: skill.security-checklist',
        '    mode: always',
        '',
      ].join('\n'),
    );
  });

  it('round-trips an item with supporting files', async () => {
    const fs = new MemFs();
    const skill: LibraryItem = {
      manifest: parseManifest({
        id: 'skill.sec',
        kind: 'skill',
        name: 'Sec',
        slug: 'sec',
        description: 'Security checks.',
        scripts: { trust: 'reviewed' },
      }),
      body: '# Sec\n',
      files: { 'references/owasp.md': Buffer.from('owasp'), 'scripts/scan.ps1': Buffer.from('x') },
    };
    const dir = itemDir(LIB, skill.manifest);
    await writeItem(fs, dir, skill);
    expect(await readItem(fs, dir)).toEqual(skill);
  });

  it('removes stale files on rewrite but keeps dotfiles', async () => {
    const fs = new MemFs();
    const dir = itemDir(LIB, agent.manifest);
    await writeItem(fs, dir, { ...agent, files: { 'notes.md': Buffer.from('old') } });
    fs.putSync(join(dir, '.DS_Store'), 'x');
    await writeItem(fs, dir, agent);
    expect(await fs.stat(join(dir, 'notes.md'))).toBeNull();
    expect(await fs.stat(join(dir, '.DS_Store'))).not.toBeNull();
  });

  it('rejects supporting files escaping the item folder (S4)', async () => {
    const fs = new MemFs();
    const bad = { ...agent, files: { '../../evil.md': Buffer.from('x') } };
    await expect(writeItem(fs, itemDir(LIB, agent.manifest), bad)).rejects.toSatisfy((e) =>
      isAmcError(e, 'PATH_OUTSIDE_ROOT'),
    );
    expect(fs.ops).toEqual([]);
  });

  it('rejects folder/slug mismatch and malformed YAML', async () => {
    const fs = new MemFs();
    await writeItem(fs, join(LIB, 'agents', 'renamed'), agent);
    await expect(readItem(fs, join(LIB, 'agents', 'renamed'))).rejects.toSatisfy((e) =>
      isAmcError(e, 'ITEM_LAYOUT_INVALID'),
    );
    fs.putSync(join(LIB, 'agents', 'x', 'amc.yaml'), 'id: [unclosed');
    await expect(readItem(fs, join(LIB, 'agents', 'x'))).rejects.toSatisfy((e) =>
      isAmcError(e, 'MANIFEST_PARSE_FAILED'),
    );
  });

  it('tolerates a BOM and a missing body file', async () => {
    const fs = new MemFs();
    const dir = itemDir(LIB, agent.manifest);
    fs.putSync(join(dir, 'amc.yaml'), '﻿' + serializeManifest(agent.manifest));
    expect((await readItem(fs, dir)).body).toBe('');
  });
});

// ---------- property: write → read → write is byte-identical ----------
const slug = fc.stringMatching(/^[a-z0-9]{1,10}(-[a-z0-9]{1,10}){0,2}$/);
// Includes YAML-hostile strings ("yes", "null", "1.0", ": x", "#", quotes, unicode).
const text = fc.oneof(
  fc.string({ minLength: 1, maxLength: 60, unit: 'grapheme' }),
  fc.constantFrom('yes', 'null', '1.0', 'true', ': colon', '# hash', '"quoted"', "it's", '- dash'),
);
const nonBlank = text.filter((s) => s.trim().length > 0);

const manifestArb: fc.Arbitrary<Manifest> = fc
  .record({
    kind: fc.constantFrom('skill', 'agent', 'command'),
    slug,
    name: nonBlank.map((s) => s.slice(0, 120)),
    description: nonBlank,
    version: fc.constantFrom('0.1.0', '1.2.3', '2.0.0-beta.1'),
    tags: fc.array(
      nonBlank.map((s) => s.slice(0, 40)),
      { maxLength: 3 },
    ),
    refs: fc.array(slug, { maxLength: 3 }),
    mode: fc.constantFrom('on-demand', 'always'),
    raw: fc.dictionary(fc.stringMatching(/^[a-z][a-zA-Z-]{0,8}$/), text, { maxKeys: 3 }),
  })
  .map((r) => {
    const base = {
      id: `${r.kind}.${r.slug}`,
      kind: r.kind,
      name: r.name,
      slug: r.slug,
      version: r.version,
      description: r.description,
      tags: r.tags,
      compat: { overrides: { 'claude-code': { raw: r.raw } } },
    };
    const extra =
      r.kind === 'skill'
        ? { dependsOn: r.refs.map((s) => `skill.${s}`) }
        : r.kind === 'agent'
          ? { skills: r.refs.map((s) => ({ ref: `skill.${s}`, mode: r.mode })) }
          : { preloadSkills: r.refs.map((s) => `skill.${s}`), arguments: [{ name: 'pr' }] };
    return parseManifest({ ...base, ...extra });
  });

describe('item IO properties', () => {
  it('write → read → write is idempotent and byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(manifestArb, text, async (manifest, body) => {
        const fs = new MemFs();
        const dir = itemDir(LIB, manifest);
        await writeItem(fs, dir, { manifest, body, files: {} });
        const first = fs.dump();
        const read = await readItem(fs, dir);
        // Only empty values may differ (they are pruned on write and re-defaulted on read).
        expect(serializeManifest(read.manifest)).toBe(serializeManifest(manifest));
        expect(read.body).toBe(body);
        await writeItem(fs, dir, read);
        expect(fs.dump()).toEqual(first);
        expect(await readItem(fs, dir)).toEqual(read);
      }),
      { numRuns: 200 },
    );
  });
});
